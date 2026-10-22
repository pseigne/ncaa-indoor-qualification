"""Collect, reconcile, and publish the monitor's JSON data."""

from collections import defaultdict
from datetime import date, datetime, timezone
import json
import os
from pathlib import Path
import re
import tempfile
import time

from qualification import get_cutoff_rank, interpret_qualification

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
MASTER = "tfrrs_historical_data.json"
GENDERS = ("m", "f")
SNAPSHOT = re.compile(r"^(.+) \((\d{4}-\d{2}-\d{2})\)$")


def load_config(path=ROOT / "scrape_config.json"):
    return validate_config(json.loads(Path(path).read_text()))


def validate_config(config):
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
    settings = config.get("discovery", {})
    if not isinstance(settings, dict) or type(settings.get("enabled", False)) is not bool:
        raise ValueError("Invalid discovery configuration")
    if settings.get("enabled"):
        from urllib.parse import urlparse
        from tfrrs_lists import HOSTS
        sources = settings.get("sources")
        if not isinstance(sources, list) or not sources:
            raise ValueError("Missing discovery sources")
        for url in sources:
            parsed = urlparse(url) if isinstance(url, str) else None
            if parsed is None or parsed.scheme != "https" or parsed.hostname not in HOSTS:
                raise ValueError("Discovery sources must be public HTTPS TFRRS pages")
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


def derive_files(records, config):
    validate_records(records)
    active_scopes = {(c["year"], c["season"], c["region"]) for c in config["active"]}
    cutoffs, active, dates = [], [], set()
    groups = defaultdict(list)
    for entry in records:
        year, season, region = entry["year"], entry["season"], entry["region"]
        event = entry["event"]
        qualification = interpret_qualification(entry)
        derived = dict(entry, qualification=qualification)
        bubble = qualification["entry"]
        cutoffs.append(dict(year=year, season=season, region=region,
                            gender=entry["gender"], event=event,
                            cutoff_rank=qualification["rank"],
                            cutoff_time=bubble["time"] if bubble is not None else None,
                            cutoff_athlete=bubble["athlete"] if bubble is not None else None,
                            cutoff_team=bubble.get("team", "N/A") if bubble is not None else None,
                            qualification=qualification))
        if (year.replace("_", "-"), season, region) in active_scopes:
            active.append(derived)
        match = SNAPSHOT.fullmatch(year)
        if match:
            dates.add(match[2])
        groups[(season, entry["gender"], event)].append(derived)
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


def publish(records, config, data_dir=DATA_DIR, config_path=None):
    """Stage every output before replacing files; roll back replacement failures."""
    files = derive_files(records, config)
    data_dir = Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    originals, replaced = {}, []
    config_target = Path(config_path) if config_path is not None else None
    with tempfile.TemporaryDirectory(prefix=".tfrrs-stage-", dir=data_dir.parent) as tmp:
        stage = Path(tmp)
        outputs = [(data_dir / name, value) for name, value in files.items()]
        if config_target is not None:
            outputs.append((config_target, validate_config(config)))
        staged = {}
        for index, (target, value) in enumerate(outputs):
            name = target.name
            # One event record per line keeps diffs focused and the recovered
            # master below GitHub's file limit without changing its JSON shape.
            encoded = (json.dumps(value, indent=4) + "\n" if name == "dates.json" or target == config_target else
                       "[\n" + ",\n".join(json.dumps(row, ensure_ascii=False, separators=(",", ":"))
                                         for row in value) + "\n]\n")
            if len(encoded.encode("utf-8")) >= 100 * 1024 * 1024:
                raise ValueError(f"{name} exceeds GitHub's 100 MiB file limit; archive storage must be partitioned")
            staged[target] = stage / f"{index}.json"
            staged[target].write_text(encoded, encoding="utf-8")
            originals[target] = target.read_bytes() if target.exists() else None
        try:
            for target, source in staged.items():
                if originals[target] == source.read_bytes():
                    continue
                os.replace(source, target)
                replaced.append(target)
        except OSError:
            for target in reversed(replaced):
                if originals[target] is None:
                    target.unlink()
                else:
                    target.write_bytes(originals[target])
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
    from tfrrs_lists import fetch_page, verify_page_identity

    owned_session = session is None
    session = session or requests.Session()
    records = []
    try:
        for cfg in configs:
            for gender in GENDERS:
                url = f"https://tf.tfrrs.org/lists/{cfg['list_id']}/{cfg['list_name']}?gender={gender}"
                print(f"Collecting {cfg['year']} {cfg['season']} {cfg['region']} {gender}", flush=True)
                html = fetch_page(session, url, sleeper)
                verify_page_identity(html, cfg, gender)
                records.extend(parse_page(html, cfg, gender))
                sleeper(1)
    finally:
        if owned_session:
            session.close()
    return records


def run_scrape(mode="active", data_dir=DATA_DIR, config=None, session=None,
               today=None, sleeper=time.sleep, discover=False,
               config_path=ROOT / "scrape_config.json"):
    import requests
    from tfrrs_lists import discover_config

    config = validate_config(config) if config is not None else load_config(config_path)
    existing = load_records(Path(data_dir) / MASTER)
    proposed = config
    owned_session = session is None
    session = session or requests.Session()
    try:
        if discover and mode == "active" and config.get("discovery", {}).get("enabled"):
            try:
                proposed = validate_config(discover_config(config, session, sleeper))
            except (requests.RequestException, ValueError) as error:
                print(f"Season discovery unavailable; keeping verified configuration: {error}", flush=True)
        try:
            collected = collect(proposed[mode], session=session, sleeper=sleeper)
        except (requests.RequestException, ValueError) as error:
            if proposed == config:
                raise
            print(f"New lists are not ready; keeping verified configuration: {error}", flush=True)
            proposed = config
            collected = collect(config[mode], session=session, sleeper=sleeper)
    finally:
        if owned_session:
            session.close()
    if mode == "active":
        today = today or datetime.now(timezone.utc).date().isoformat()
        date.fromisoformat(today)
        collected += [dict(entry, year=f"{entry['year']} ({today})") for entry in collected]
    records = merge_records(existing, collected)
    changed = publish(records, proposed, data_dir,
                      config_path=config_path if proposed != config else None)
    if proposed != config:
        print("Saved validated season configuration", flush=True)
    print(f"Validated {len(records)} records; updated {changed} files", flush=True)
    return records
