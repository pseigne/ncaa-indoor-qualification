"""Import the NCAA's accepted lists into data/archive/entries, once a season.

    python import_entries.py indoor 2025-2026
    python import_entries.py outdoor 2026
    python import_entries.py indoor --from 2015

The accepted lists come from RecordTiming (rtspt.py reads its cache before it
fetches anything). Each accepted entry is matched to the season's final TFRRS
list: the archive's for the seasons it holds, otherwise the list cached at
limit 100 by list_cache.py. Years are championship years, so indoor 2015 is
2014-2015. The outdoor decathlon and heptathlon are chosen from the national
list, not at the First Rounds, so they have no field line and are left out.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent
# Isolated runs (python -I) leave the repository off the path.
sys.path.insert(0, str(ROOT))

from hytek import parse_performance_list  # noqa: E402
from list_cache import CACHE_DIR as LIST_CACHE, check_page, read_cached  # noqa: E402
from matching import (ALIASES, beyond_depth, load_aliases, match_entries, row_marks,  # noqa: E402
                      same_school, same_surname)
from qualification import ROW_KEYS, get_cutoff_rank, interpret_field  # noqa: E402
import rtspt  # noqa: E402
from tfrrs_data import (ARCHIVE, DATA_DIR, ENTRIES, ENTRY_REGIONS as REGIONS, GENDERS, MATCHES,  # noqa: E402
                        finished, load_archive, load_championships, load_config, split_year, validate_entries)

LIST_LIMIT = 100
# TFRRS's default page, for saved lists without a depth.
DEFAULT_DEPTH = 50
MULTIS = {"Decathlon", "Heptathlon"}


class NotImportable(ValueError):
    """A season that can't be imported as it stands."""


def season_year(season, year):
    """indoor 2015 is 2014-2015; indoor 2014-2015 and outdoor 2015 stay as they are."""
    year = str(year).replace("_", "-")
    if season == "indoor" and re.fullmatch(r"\d{4}", year):
        return f"{int(year) - 1}-{year}"
    return year


def championship_year(year):
    return int(str(year).split("-")[-1])


def entries_path(data_dir, season, year):
    return Path(data_dir) / ARCHIVE / ENTRIES / season / f"{year}.json"


def season_configs(config, season, year):
    """Each region's list for the season, preferring the configuration the daily scrape used."""
    found = {}
    for group in ("archive", "historical", "active"):
        for cfg in config.get(group) or []:
            if cfg["season"] == season and cfg["year"] == year:
                found[cfg["region"]] = cfg
    return found


def no_meet(configs):
    return any(cfg.get("status") == "cancelled" for cfg in configs.values())


def seasons(season, config, start, end=None):
    """Every season from `start` to `end` (championship years), without seasons that had no meet."""
    years = sorted({cfg["year"] for group in ("archive", "historical", "active")
                    for cfg in config.get(group) or [] if cfg["season"] == season},
                   key=championship_year)
    end = end or max(championship_year(year) for year in years)
    return [year for year in years if start <= championship_year(year) <= end
            and not no_meet(season_configs(config, season, year))]


def read_page(path):
    """A cached page, its metadata, and its parse."""
    path = Path(path)
    body = path.read_bytes()
    meta_file = rtspt.meta_path(path)
    meta = json.loads(meta_file.read_text()) if meta_file.exists() else {}
    digest = hashlib.sha256(body).hexdigest()
    if meta.get("sha256") not in (None, digest):
        raise NotImportable(f"{path.name} no longer matches its recorded checksum")
    return body, meta, digest, parse_performance_list(body)


def accepted_pages(season, year, paths):
    """The season's accepted lists by (region, gender). Pages for another meet are refused."""
    pages = {}
    word = "Indoor" if season == "indoor" else "Outdoor"
    for path in paths:
        body, meta, digest, page = read_page(path)
        if page["kind"] != "accepted":
            continue
        if str(championship_year(year)) not in page["meet"] or word not in page["meet"]:
            raise NotImportable(f"{Path(path).name} is not the {year} {season} championship: {page['meet']}")
        if page["region"] not in REGIONS[season]:
            raise NotImportable(f"{Path(path).name} has an unexpected region: {page['region']}")
        genders = {event["gender"] for event in page["events"]}
        if len(genders) != 1:
            raise NotImportable(f"{Path(path).name} holds more than one gender")
        key = (page["region"], genders.pop())
        if key in pages:
            raise NotImportable(f"Two accepted lists for {key[0]} {key[1]}: {pages[key]['path'].name}, {Path(path).name}")
        pages[key] = dict(path=Path(path), page=page, source=dict(
            kind="accepted", gender=key[1], region=key[0], url=meta.get("url"),
            generated=page["generated"], fetched=(meta.get("fetched") or "")[:10] or None, sha256=digest))
    missing = [f"{region} {gender}" for region in REGIONS[season] for gender in GENDERS
               if (region, gender) not in pages]
    if missing:
        raise NotImportable(f"No accepted list for {', '.join(missing)}")
    return pages


def final_lists(season, year, configs, records, list_cache):
    """The final TFRRS rankings for every (region, gender, event), and where they came from."""
    saved = {(r["region"], r["gender"], r["event"]): r["rankings"] for r in records
             if r["season"] == season and r["year"] == year}
    finals, lists, archived = {}, [], True
    for region in REGIONS[season]:
        cfg = configs.get(region)
        if cfg is None:
            raise NotImportable(f"No configured {season} {year} {region} list")
        if any(key[0] == region for key in saved):
            finals.update({key: rows for key, rows in saved.items() if key[0] == region})
            lists.append(dict(region=region, list_id=cfg["list_id"], depth=cfg.get("depth", DEFAULT_DEPTH)))
            continue
        archived = False
        for gender in GENDERS:
            html = read_cached(cfg, gender, LIST_LIMIT, list_cache)
            if html is None:
                raise NotImportable(f"No cached {LIST_LIMIT}-deep list for {season} {year} {region} {gender} "
                                   f"(list {cfg['list_id']}); run list_cache.py")
            for record in check_page(html, cfg, gender, LIST_LIMIT):
                finals[(region, gender, record["event"])] = record["rankings"]
        lists.append(dict(region=region, list_id=cfg["list_id"], depth=LIST_LIMIT))
    return finals, lists, archived


def accepted_entries(event):
    """A full list marks who declared with D; anything else on it is not in the field."""
    if any(entry["status"] == "D" for entry in event["entries"]):
        return [entry for entry in event["entries"] if entry["status"] == "D"]
    return event["entries"]


def stored_row(row):
    return {key: row[key] for key in ROW_KEYS if row.get(key) is not None}


def import_season(season, year, entries_cache=rtspt.CACHE_DIR, list_cache=LIST_CACHE, data_dir=DATA_DIR,
                  aliases_path=ALIASES, config=None, championships=None, today=None, session=None,
                  out=print):
    """Match a season's accepted lists and return (the entries file, its report totals)."""
    year = season_year(season, year)
    config = config or load_config()
    configs = season_configs(config, season, year)
    if not configs:
        raise NotImportable(f"No configured {season} {year} lists")
    if no_meet(configs):
        raise NotImportable(f"There was no {season} {year} championship")
    championships = load_championships() if championships is None else championships
    today = today or datetime.now(timezone.utc).date().isoformat()
    for cfg in config["active"]:
        if cfg["season"] == season and cfg["year"] == year and not finished(cfg, today, championships):
            raise NotImportable(f"The {season} {year} lists are not final yet")
    records = [r for r in load_archive(data_dir)[0] if split_year(r["year"])[1] is None]
    finals, lists, archived = final_lists(season, year, configs, records, list_cache)
    paths = rtspt.fetch_season(season, year, session=session, cache_dir=entries_cache)
    pages = accepted_pages(season, year, paths)
    aliases = load_aliases(aliases_path)
    cancelled = any(cfg.get("meet") == "cancelled" for cfg in configs.values())
    totals = dict(entries=0, matched=0, unmatched=0, beyond=0, events=0,
                  available=0, unmatched_events=0, beyond_events=0)
    fields = []
    out(f"== {season} {year}" + (" (meet cancelled)" if cancelled else ""))
    for region, gender in sorted(pages):
        item = pages[(region, gender)]
        page = item["page"]
        listed = {event for (r, g, event) in finals if (r, g) == (region, gender)}
        events = [event["event"] for event in page["events"]]
        expected = listed - (MULTIS if season == "outdoor" else set())
        if len(set(events)) != len(events) or set(events) != expected:
            raise NotImportable(f"{item['path'].name} events differ from the saved {region} {gender} list: "
                               f"missing {sorted(expected - set(events))}, unlisted {sorted(set(events) - expected)}")
        out(f"-- {item['path'].name}: {region} {gender} ({page['generated'] or 'no generated time'})")
        for event in page["events"]:
            rankings = finals[(region, gender, event["event"])]
            scope = dict(season=season, year=year, gender=gender, event=event["event"])
            results = match_entries(accepted_entries(event), rankings, aliases, relay=event["relay"], scope=scope)
            entries = []
            for result in results:
                entry = result["entry"]
                saved = dict(name=entry["name"], school=entry["school"], seed=entry["seed"],
                             list_rank=result["list_rank"], match=result["match"])
                if result["row"] is not None and not archived:
                    saved["row"] = stored_row(result["row"])
                if result["row"] is None and beyond_depth(entry, rankings, event["event"]):
                    saved["beyond"] = True
                entries.append(saved)
            fields.append(dict(gender=gender, region=region, event=event["event"], entries=entries))
            record = dict(event=event["event"], season=season, region=region, year=year, rankings=rankings)
            field = interpret_field(record, entries, page["generated"], cancelled)
            report_event(event, field, entries, rankings, aliases, record, out)
            totals["events"] += 1
            totals["entries"] += len(entries)
            totals["matched"] += sum(e["list_rank"] is not None for e in entries)
            totals["unmatched"] += field["unmatched"]
            totals["beyond"] += sum(bool(e.get("beyond")) for e in entries)
            totals[{"available": "available", "unmatched": "unmatched_events",
                    "beyond_list": "beyond_events"}[field["status"]]] += 1
    out(f"Total: {totals['events']} events, {totals['entries']} entries, {totals['matched']} matched, "
        f"{totals['unmatched']} unmatched, {totals['beyond']} beyond the saved list; "
        f"{totals['available']} field lines, {totals['unmatched_events']} unmatched events, "
        f"{totals['beyond_events']} past the list")
    saved = dict(season=season, year=year, cancelled=cancelled,
                 sources=[pages[key]["source"] for key in sorted(pages)], lists=lists, fields=fields)
    validate_entries(saved)
    return saved, totals


def report_event(event, field, entries, rankings, aliases, record, out):
    line = get_cutoff_rank(record["event"], record["season"], record["region"], record["year"])
    counts = {label: sum(e["match"] == label for e in entries) for label in MATCHES[:-1]}
    how = ", ".join(f"{label} {count}" for label, count in counts.items() if count)
    if field["status"] == "available":
        summary = (f"line {line}, field reached {field['rank']}" + (f", in {field['in']}" if field["in"] else "")
                   + (f", out {field['out']}" if field["out"] else ""))
    elif field["status"] == "beyond_list":
        summary = f"past the {len(rankings)} saved rows"
    else:
        summary = f"{field['unmatched']} UNMATCHED"
    out(f"   {event['gender']} {event['event']}: {field['size']} accepted ({how}); {summary}")
    used = {e["list_rank"] for e in entries}
    for entry in entries:
        if entry["list_rank"] is not None:
            continue
        near = [row for row in rankings if row["rank"] not in used and (
            entry["seed"] in row_marks(row) or same_surname(entry["name"], row["athlete"]))]
        hints = [f"{row['rank']}:{row['athlete']}/{row['team']}/{row['time']}" for row in near[:3]]
        schools = sorted({row["team"] for row in near if not same_school(entry["school"], row["team"],
                                                                         aliases.get("schools", {}))})
        tag = "beyond" if entry.get("beyond") else "UNMATCHED"
        out(f"      {tag} {entry['name']} ({entry['school']}) {entry['seed']}"
            + (f"  near: {'; '.join(hints)}" if hints else "")
            + (f"  alias? {', '.join(json.dumps({entry['school']: team}) for team in schools[:2])}"
               if schools and not event["relay"] else ""))


def encode_entries(saved):
    """One source, list or entry per line, so a re-import shows as a few changed lines."""
    def line(item):
        return json.dumps(item, ensure_ascii=False, separators=(",", ":"))

    parts = [f'"{key}":{line(saved[key])}' for key in ("season", "year", "cancelled")]
    for key in ("sources", "lists"):
        parts.append(f'"{key}":[\n' + ",\n".join(line(item) for item in saved[key]) + "\n]")
    fields = []
    for field in saved["fields"]:
        head = line({key: field[key] for key in ("gender", "region", "event")})[:-1]
        fields.append(head + ',"entries":[\n' + ",\n".join(line(entry) for entry in field["entries"]) + "\n]}")
    parts.append('"fields":[\n' + ",\n".join(fields) + "\n]")
    return "{\n" + ",\n".join(parts) + "\n}\n"


def write_entries(saved, data_dir=DATA_DIR):
    path = entries_path(data_dir, saved["season"], saved["year"])
    path.parent.mkdir(parents=True, exist_ok=True)
    text = encode_entries(saved)
    if json.loads(text) != saved:
        raise ValueError("Entries file does not read back as written")
    path.write_text(text, encoding="utf-8")
    return path


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("season", choices=sorted(REGIONS))
    parser.add_argument("years", nargs="*", help="e.g. 2025-2026 or 2026; indoor 2015 is 2014-2015")
    parser.add_argument("--from", dest="start", type=int, help="first championship year")
    parser.add_argument("--to", dest="end", type=int, help="last championship year")
    parser.add_argument("--entries-cache", type=Path, default=rtspt.CACHE_DIR)
    parser.add_argument("--list-cache", type=Path, default=LIST_CACHE)
    parser.add_argument("--data-dir", type=Path, default=DATA_DIR)
    parser.add_argument("--aliases", type=Path, default=ALIASES)
    parser.add_argument("--allow-unmatched", action="store_true",
                        help="write seasons that still have unmatched entries")
    args = parser.parse_args(argv)
    config = load_config()
    years = [season_year(args.season, year) for year in args.years]
    if args.start is not None:
        years += [year for year in seasons(args.season, config, args.start, args.end) if year not in years]
    if not years:
        parser.error("give a year or --from")
    failed = False
    session = None
    try:
        import requests

        session = requests.Session()
        for year in years:
            try:
                saved, totals = import_season(args.season, year, args.entries_cache, args.list_cache, args.data_dir,
                                              args.aliases, config, session=session)
            except (NotImportable, rtspt.Refused) as error:
                print(f"{args.season} {year}: {error}", flush=True)
                failed = True
                continue
            if totals["unmatched"] and not args.allow_unmatched:
                print(f"{args.season} {year}: {totals['unmatched']} unmatched; not written "
                      "(add aliases, or pass --allow-unmatched)", flush=True)
                failed = True
                continue
            print(f"Wrote {write_entries(saved, args.data_dir)}", flush=True)
    finally:
        if session is not None:
            session.close()
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
