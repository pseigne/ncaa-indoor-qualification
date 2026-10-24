"""One-time backfill of final TFRRS lists into data/archive/past_cutoffs.json.

Pages are cached under data/list-cache and are not fetched again. Already
saved final lists stay in the archive and are not requested.
"""

from pathlib import Path
import json
import re
import time

import requests

from qualification import get_cutoff_rank, is_relay
from tfrrs_data import ARCHIVE, DATA_DIR, PAST_CUTOFFS, load_config, load_records, mark_conversion, parse_page, record_key
from tfrrs_lists import fetch_page, verify_page_identity

ROOT = Path(__file__).resolve().parent
CACHE = DATA_DIR / "list-cache"
OUT = DATA_DIR / ARCHIVE / PAST_CUTOFFS
PAUSE = 5
USER_AGENT = (
    "NCAA qualifying lines historical backfill "
    "(https://github.com/pseigne/ncaa-indoor-qualification)"
)
HEADERS = {"User-Agent": USER_AGENT, "Referer": "https://www.tfrrs.org/"}
GENDERS = ("m", "f")
UNLISTED = {"", "N/A", "NT", "DQ", "DNS", "DNF", "FS", "NH", "NM", "FOUL"}

# Names the season pages already use. Older headings get folded onto these.
EVENT_ALIASES = {
    "1 mile": "Mile",
    "mile run": "Mile",
    "one mile": "Mile",
    "100 meter hurdles": "100 Hurdles",
    "100m hurdles": "100 Hurdles",
    "100 meters hurdles": "100 Hurdles",
    "110 meter hurdles": "110 Hurdles",
    "110m hurdles": "110 Hurdles",
    "110 meters hurdles": "110 Hurdles",
    "400 meter hurdles": "400 Hurdles",
    "400m hurdles": "400 Hurdles",
    "400 meters hurdles": "400 Hurdles",
    "3000m steeplechase": "3000 Steeplechase",
    "3000 meter steeplechase": "3000 Steeplechase",
    "3000 meters steeplechase": "3000 Steeplechase",
    "steeplechase": "3000 Steeplechase",
    "10000 meters": "10,000 Meters",
    "10,000 meters": "10,000 Meters",
    "discus throw": "Discus",
    "hammer throw": "Hammer",
    "javelin throw": "Javelin",
    "weight": "Weight Throw",
    "35 lb weight throw": "Weight Throw",
    "35-lb weight throw": "Weight Throw",
    "4x100 relay": "4 x 100 Relay",
    "4 x 100m relay": "4 x 100 Relay",
    "4x100m relay": "4 x 100 Relay",
    "4x400 relay": "4 x 400 Relay",
    "4 x 400m relay": "4 x 400 Relay",
    "4x400m relay": "4 x 400 Relay",
    "distance medley": "Distance Medley Relay",
    "dmr": "Distance Medley Relay",
}

KEEP = {
    "60 Meters", "200 Meters", "400 Meters", "800 Meters", "Mile", "3000 Meters",
    "5000 Meters", "60 Hurdles", "4 x 400 Relay", "Distance Medley Relay",
    "High Jump", "Pole Vault", "Long Jump", "Triple Jump", "Shot Put",
    "Weight Throw", "Heptathlon", "Pentathlon", "100 Meters", "110 Hurdles",
    "100 Hurdles", "400 Hurdles", "1500 Meters", "3000 Steeplechase",
    "10,000 Meters", "4 x 100 Relay", "Discus", "Hammer", "Javelin", "Decathlon",
}


def canonical_event(name):
    folded = re.sub(r"\s+", " ", name).strip()
    return EVENT_ALIASES.get(folded.lower(), folded)


def split_saved_mark(text):
    flags = re.findall(r"#|@|\(\d+\)", text or "")
    clean = re.sub(r"\s*(?:#|@|\(\d+\))\s*", " ", text or "")
    clean = re.sub(r"\s+", " ", clean).strip()
    return clean, "".join(flags) or None


def reference_rank(event, season, region, year):
    """Row to store. Standards years have no line; the 16th (12th for relays) is reference only."""
    rank = get_cutoff_rank(event, season, region, year)
    if rank is None:
        return 12 if is_relay(event) else 16
    return rank


def wanted(record):
    if record["event"] not in KEEP:
        return False
    if record["season"] == "outdoor" and record["region"] == "National":
        return record["event"] in {"Decathlon", "Heptathlon"}
    return True


def line_from_rankings(record, cfg):
    event = record["event"]
    status = cfg.get("status")
    rule = "cancelled" if status == "cancelled" else (
        "standards" if get_cutoff_rank(event, record["season"], record["region"], record["year"]) is None else "line"
    )
    rank = reference_rank(event, record["season"], record["region"], record["year"])
    rankings = record["rankings"]
    row = next((item for item in rankings if item["rank"] == rank), None)
    if row is None:
        if rule != "cancelled":
            return None
        return dict(season=record["season"], region=record["region"], gender=record["gender"],
                    event=event, year=record["year"].replace("_", "-"), rank=rank, rule=rule,
                    comparable=False, note="Season cancelled", athlete="", team="", mark="")
    mark, flag = (row["time"], row.get("flag"))
    if "flag" not in row:
        mark, flag = split_saved_mark(row["time"])
    converted = row.get("converted")
    athlete = row.get("athlete") or ""
    team = row.get("team") or ""
    place = row.get("place", rank)
    nxt = next((item for item in rankings if item["rank"] == rank + 1), None)
    tie = None
    if nxt is not None and rule != "cancelled":
        next_mark = nxt["time"] if nxt.get("flag") or "converted" in nxt else split_saved_mark(nxt["time"])[0]
        if mark and next_mark == mark and mark not in UNLISTED:
            tie = dict(rank=nxt.get("place", rank + 1), athlete=nxt.get("athlete") or "", team=nxt.get("team") or "")
    line = dict(
        season=record["season"], region=record["region"], gender=record["gender"], event=event,
        year=record["year"].replace("_", "-"), rank=rank, place=place,
        mark=mark, conversion=mark_conversion(mark, flag),
        athlete=athlete, team=team, rule=rule, comparable=rule == "line",
    )
    if rule == "line":
        line["of"] = rank
    if flag:
        line["flag"] = flag
    if converted:
        line["converted"] = converted
    if cfg.get("meet") == "cancelled":
        line["note"] = "No meet (COVID)"
    if rule == "cancelled":
        line["note"] = "Season cancelled"
        line["comparable"] = False
    if tie:
        line["tie"] = tie
    if not mark or mark in UNLISTED:
        if rule == "cancelled":
            line["mark"] = ""
            return line
        return None
    return line


def cache_file(list_id, gender):
    return CACHE / f"{list_id}-{gender}.html"


def load_cached(cfg, gender):
    path = cache_file(cfg["list_id"], gender)
    if not path.exists() or path.stat().st_size < 50000:
        return None
    text = path.read_text(encoding="utf-8", errors="replace")
    if "panel-title" not in text or "performance-list-row" not in text:
        return None
    return text


def fetch_archive(configs):
    CACHE.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    fetched = 0
    failures = []
    parsed = []
    try:
        for cfg in configs:
            for gender in GENDERS:
                label = f"{cfg['list_id']} {cfg['year']} {cfg['season']} {cfg['region']} {gender}"
                html = load_cached(cfg, gender)
                if html is None:
                    if fetched or failures:
                        time.sleep(PAUSE)
                    url = f"https://tf.tfrrs.org/lists/{cfg['list_id']}/{cfg['list_name']}?gender={gender}"
                    print(f"Fetching {label}", flush=True)
                    try:
                        html = fetch_page(session, url, sleeper=lambda delay: time.sleep(max(PAUSE, delay)), headers=HEADERS)
                    except requests.RequestException as error:
                        failures.append(dict(list_id=cfg["list_id"], gender=gender, error=str(error)))
                        print(f"  failed: {error}", flush=True)
                        continue
                    fetched += 1
                    cache_file(cfg["list_id"], gender).write_text(html, encoding="utf-8")
                else:
                    print(f"Cached {label}", flush=True)
                try:
                    verify_page_identity(html, cfg, gender)
                    page = parse_page(html, cfg, gender)
                except ValueError as error:
                    failures.append(dict(list_id=cfg["list_id"], gender=gender, error=str(error)))
                    print(f"  rejected: {error}", flush=True)
                    continue
                for record in page:
                    record["event"] = canonical_event(record["event"])
                parsed.extend(page)
    finally:
        session.close()
    return parsed, fetched, failures


def saved_records(configs):
    wanted_keys = {(cfg["year"].replace("_", "-"), cfg["season"], cfg["region"]) for cfg in configs}
    by_cfg = {key: cfg for cfg, key in zip(configs, wanted_keys)}
    chosen = {}
    for record in load_records():
        if re.search(r"\(\d{4}-\d{2}-\d{2}\)$", str(record.get("year", ""))):
            continue
        key = (record["year"].replace("_", "-"), record["season"], record["region"])
        if key not in wanted_keys:
            continue
        record = dict(record)
        record["year"] = key[0]
        record["event"] = canonical_event(record["event"])
        chosen[record_key(record)] = (record, by_cfg[key])
    return chosen


def main():
    config = load_config()
    archive = config.get("archive") or []
    if not archive:
        raise SystemExit("scrape_config.json has no archive lists")
    fresh_keys = {(cfg["year"], cfg["season"], cfg["region"]) for cfg in archive}
    saved = []
    seen = set()
    for cfg in config["historical"] + config["active"]:
        key = (cfg["year"], cfg["season"], cfg["region"])
        if key in fresh_keys or key in seen:
            continue
        seen.add(key)
        saved.append(cfg)

    parsed, fetched, failures = fetch_archive(archive)
    unknown = set()
    lines = []
    for record in parsed:
        if record["event"] not in KEEP:
            unknown.add((record["season"], record["year"], record["event"]))
        if not wanted(record):
            continue
        cfg = next(item for item in archive
                   if item["year"] == record["year"] and item["season"] == record["season"] and item["region"] == record["region"])
        line = line_from_rankings(record, cfg)
        if line:
            lines.append(line)

    for record, cfg in saved_records(saved).values():
        if record["event"] not in KEEP:
            unknown.add((record["season"], record["year"], record["event"]))
        if not wanted(record):
            continue
        line = line_from_rankings(record, cfg)
        if line:
            lines.append(line)

    lines.sort(key=lambda line: (line["year"], line["season"], line["region"], line["gender"], line["event"]))
    OUT.write_text(json.dumps(dict(lines=lines), ensure_ascii=False, indent=2) + "\n")
    print(f"Fetched {fetched} list pages", flush=True)
    print(f"Wrote {len(lines)} lines to {OUT.name}", flush=True)
    if unknown:
        print("Unrecognized events:", flush=True)
        for item in sorted(unknown):
            print(" ", item, flush=True)
    if failures:
        print(f"{len(failures)} pages failed:", flush=True)
        for item in failures:
            print(" ", item, flush=True)
    mile = [line for line in lines if line["event"] == "Mile" and line["season"] == "indoor"]
    print(f"Indoor mile lines: {len(mile)}", flush=True)
    for line in mile:
        if line["gender"] == "m":
            print(f"  {line['year']} {line['mark']} place {line.get('place')} {line['rule']} {line.get('athlete')}", flush=True)
    return fetched, failures


if __name__ == "__main__":
    main()
