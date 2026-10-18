"""Collect, reconcile, and publish the monitor's JSON data."""

from collections import defaultdict
from datetime import date, datetime, timezone
import json
import os
from pathlib import Path
import re
import tempfile
import time

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
MASTER = "tfrrs_historical_data.json"
GENDERS = ("m", "f")
SNAPSHOT = re.compile(r"^(.+) \((\d{4}-\d{2}-\d{2})\)$")


def load_config(path=ROOT / "scrape_config.json"):
    config = json.loads(Path(path).read_text())
    for group in ("active", "historical"):
        if not isinstance(config.get(group), list) or not config[group]:
            raise ValueError(f"Missing {group} list configuration")
        seen = set()
        for item in config[group]:
            if any(not isinstance(item.get(k), str) or not item[k].strip()
                   for k in ("year", "season", "region", "list_id", "list_name")):
                raise ValueError(f"Invalid {group} list: {item}")
            if item["season"] not in {"indoor", "outdoor"} or item["region"] not in {"National", "East", "West"}:
                raise ValueError(f"Invalid season or region: {item}")
            if not item["list_id"].isdigit() or not re.fullmatch(r"[A-Za-z0-9_]+", item["list_name"]):
                raise ValueError(f"Invalid TFRRS list URL: {item}")
            if not re.fullmatch(r"\d{4}(?:-\d{4})?", item["year"]):
                raise ValueError(f"Invalid year: {item}")
            key = (item["year"], item["season"], item["region"])
            if key in seen:
                raise ValueError(f"Duplicate list: {key}")
            seen.add(key)
    return config


def record_key(record):
    return (record["year"].replace("_", "-"), record["season"],
            record["region"], record["gender"], record["event"])


def validate_records(records):
    if not isinstance(records, list) or not records:
        raise ValueError("The master database must be a nonempty list")
    for record in records:
        if not isinstance(record, dict) or any(
            not isinstance(record.get(k), str) or not record[k].strip()
            for k in ("year", "season", "region", "gender", "event")
        ):
            raise ValueError("Invalid event record")
        if record["season"] not in {"indoor", "outdoor"} or record["gender"] not in GENDERS:
            raise ValueError(f"Invalid event metadata: {record_key(record)}")
        if record["region"] not in {"National", "East", "West", "Unified"}:
            raise ValueError(f"Invalid region: {record_key(record)}")
        year = record["year"].replace("_", "-")
        match = SNAPSHOT.fullmatch(year)
        if match:
            date.fromisoformat(match[2])
            year = match[1]
        if not re.fullmatch(r"\d{4}(?:-\d{4})?", year):
            raise ValueError(f"Invalid year: {record['year']}")
        rankings = record.get("rankings")
        if not isinstance(rankings, list) or not rankings:
            raise ValueError(f"Missing rankings: {record_key(record)}")
        ranks = []
        for row in rankings:
            if not isinstance(row, dict) or type(row.get("rank")) is not int or row["rank"] < 1:
                raise ValueError("Invalid ranking")
            if any(not isinstance(row.get(k), str) or not row[k].strip() for k in ("athlete", "time")):
                raise ValueError("Missing athlete or performance")
            ranks.append(row["rank"])
        if len(set(ranks)) != len(ranks):
            raise ValueError("Duplicate ranks in an event")
    return records


def load_records(path=DATA_DIR / MASTER):
    # Never silently replace a missing or corrupt database with an empty one.
    return validate_records(json.loads(Path(path).read_text()))


def merge_records(*batches):
    merged = {}
    for batch in batches:
        for record in validate_records(batch):
            merged[record_key(record)] = record
    return [merged[key] for key in sorted(merged)]


def get_cutoff_rank(event_name, season, region):
    if season == "outdoor":
        return 24 if "4x" in event_name or region == "National" else 48
    return 12 if "4x" in event_name or "Distance Medley" in event_name else 16


def derive_files(records, config):
    validate_records(records)
    active_scopes = {(c["year"], c["season"], c["region"]) for c in config["active"]}
    cutoffs, active, dates = [], [], set()
    groups = defaultdict(list)
    for entry in records:
        year, season, region = entry["year"], entry["season"], entry["region"]
        event, rankings = entry["event"], entry["rankings"]
        rank = min(get_cutoff_rank(event, season, region), len(rankings))
        bubble = next((row for row in rankings if row["rank"] == rank), None)
        if bubble:
            cutoffs.append(dict(year=year, season=season, region=region,
                                gender=entry["gender"], event=event, cutoff_rank=rank,
                                cutoff_time=bubble["time"], cutoff_athlete=bubble["athlete"],
                                cutoff_team=bubble.get("team", "N/A")))
        if (year.replace("_", "-"), season, region) in active_scopes:
            active.append(entry)
        match = SNAPSHOT.fullmatch(year)
        if match:
            dates.add(match[2])
        groups[(season, entry["gender"], event)].append(entry)
    if not active:
        raise ValueError("No configured active standings in the master database")
    files = {MASTER: records, "dates.json": sorted(dates),
             "tfrrs_bubble_cutoffs.json": cutoffs, "tfrrs_active_data.json": active}
    for (season, gender, event), entries in groups.items():
        name = re.sub(r"_+", "_", re.sub(r"[^a-zA-Z0-9]", "_", event)).strip("_")
        filename = f"historical_{season}_{gender}_{name}.json"
        if filename in files:
            raise ValueError(f"Event filename collision: {filename}")
        files[filename] = entries
    return files


def publish(records, config, data_dir=DATA_DIR):
    """Stage every output before replacing files; roll back replacement failures."""
    files = derive_files(records, config)
    data_dir = Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    originals, replaced = {}, []
    with tempfile.TemporaryDirectory(prefix=".tfrrs-stage-", dir=data_dir.parent) as tmp:
        stage = Path(tmp)
        for name, value in files.items():
            # One event record per line keeps diffs focused and the recovered
            # master below GitHub's file limit without changing its JSON shape.
            encoded = (json.dumps(value, indent=4) + "\n" if name == "dates.json" else
                       "[\n" + ",\n".join(json.dumps(row, ensure_ascii=False, separators=(",", ":"))
                                         for row in value) + "\n]\n")
            if len(encoded.encode("utf-8")) >= 100 * 1024 * 1024:
                raise ValueError(f"{name} exceeds GitHub's 100 MiB file limit; archive storage must be partitioned")
            (stage / name).write_text(encoded, encoding="utf-8")
            target = data_dir / name
            originals[name] = target.read_bytes() if target.exists() else None
        try:
            for name in files:
                target = data_dir / name
                if originals[name] == (stage / name).read_bytes():
                    continue
                os.replace(stage / name, target)
                replaced.append(name)
        except OSError:
            for name in reversed(replaced):
                target = data_dir / name
                if originals[name] is None:
                    target.unlink()
                else:
                    target.write_bytes(originals[name])
            raise
    return len(replaced)


def parse_page(html, cfg, gender):
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    headers = soup.select("div.custom-table-title")
    if not headers:
        raise ValueError("No event headings found; page may be blocked or changed")
    records = []
    for heading in headers:
        title = heading.find("h3")
        table = heading.find_next_sibling("div", class_="performance-list")
        if title is None or table is None:
            raise ValueError("Unrecognized event markup")
        name = re.sub(r"\(.*?\)", "", title.get_text(" ", strip=True))
        for prefix in ("Men's", "Women's", "Men", "Women"):
            name = name.replace(prefix, "")
        name = re.sub(r"\s+", " ", name).strip()
        rows = table.select("div.performance-list-row")[:60]
        if not name or not rows:
            raise ValueError("Empty event or rankings")
        rankings = []
        for rank, row in enumerate(rows, 1):
            def value_for(*labels):
                for label in labels:
                    cell = row.find("div", attrs={"data-label": label})
                    if cell is not None and cell.get_text(strip=True):
                        return cell.get_text(strip=True)
                raise ValueError(f"Missing {'/'.join(labels)} in {name}, row {rank}")

            # Relay rows identify a school rather than an individual. Field and
            # combined events use Mark/Points; keep the existing JSON time key.
            values = dict(athlete=value_for("Team") if "Relay" in name else value_for("Athlete"),
                          team=value_for("Team"), time=value_for("Time", "Mark", "Points"))
            rankings.append(dict(rank=rank, **values))
        records.append(dict(year=cfg["year"], season=cfg["season"], region=cfg["region"],
                            gender=gender, event=name, rankings=rankings))
    validate_records(records)
    if len({record_key(r) for r in records}) != len(records):
        raise ValueError("Duplicate event headings")
    return records


def collect(configs, session=None, sleeper=time.sleep):
    import requests

    owned_session = session is None
    session = session or requests.Session()
    records = []
    try:
        for cfg in configs:
            for gender in GENDERS:
                url = f"https://tf.tfrrs.org/lists/{cfg['list_id']}/{cfg['list_name']}?gender={gender}"
                print(f"Collecting {cfg['year']} {cfg['season']} {cfg['region']} {gender}", flush=True)
                for attempt in range(3):
                    try:
                        response = session.get(url, timeout=(10, 45), headers={
                            "User-Agent": "Mozilla/5.0 (compatible; TFRRS-Monitor/1.0)",
                            "Referer": "https://www.tfrrs.org/",
                        })
                        response.raise_for_status()
                        break
                    except requests.RequestException:
                        if attempt == 2:
                            raise
                        sleeper(2 ** attempt)
                records.extend(parse_page(response.text, cfg, gender))
                sleeper(1)
    finally:
        if owned_session:
            session.close()
    return records


def run_scrape(mode="active", data_dir=DATA_DIR, config=None, session=None,
               today=None, sleeper=time.sleep):
    config = config or load_config()
    existing = load_records(Path(data_dir) / MASTER)
    collected = collect(config[mode], session=session, sleeper=sleeper)
    if mode == "active":
        today = today or datetime.now(timezone.utc).date().isoformat()
        date.fromisoformat(today)
        collected += [dict(entry, year=f"{entry['year']} ({today})") for entry in collected]
    records = merge_records(existing, collected)
    changed = publish(records, config, data_dir)
    print(f"Validated {len(records)} records; updated {changed} files", flush=True)
    return records
