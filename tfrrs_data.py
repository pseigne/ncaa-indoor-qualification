"""Collect, reconcile, and publish the monitor's JSON data."""

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import tempfile
import time

from nationals import derive_nationals, load_nationals, nationals_index
from qualification import get_cutoff_rank, interpret_field, interpret_qualification

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
# The saved lists, one file per season. A saved day is kept only when a list changed.
ARCHIVE = "archive"
# What the site loads: small files, one per season, gender and region.
SITE = "site"
PAST_CUTOFFS = "past_cutoffs.json"
# The NCAA's accepted lists, matched to the final lists: archive/entries/{season}/{year}.json.
ENTRIES = "entries"
ENTRY_REGIONS = {"indoor": ("National",), "outdoor": ("East", "West")}
MATCHES = ("exact", "mark", "name", "manual", "none")
CHAMPIONSHIPS = ROOT / "ncaa-qualification" / "src" / "config" / "championships.json"
# How many places each saved day keeps for the season dialog's race.
STRIP_ROWS = 20
# Days after a championship starts that its season is still collected, in case the list is corrected.
FINAL_AFTER = 14
GENDERS = ("m", "f")
# Rows kept per event on a list of TFRRS's default length.
ROW_CAP = 60
# Rows kept past a list's depth, for marks tied at its last place.
TIE_MARGIN = 20
SNAPSHOT = re.compile(r"^(.+) \((\d{4}-\d{2}-\d{2})\)$")
MARK_FLAG = re.compile(r"#|@|\(\d+\)")


def load_config(path=ROOT / "scrape_config.json"):
    return validate_config(json.loads(Path(path).read_text()))


def validate_config(config):
    for group in ("active", "historical", "archive"):
        if group == "archive" and group not in config:
            continue
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
            # A historical list whose saved rankings can't be trusted stays in the master but off the site.
            if type(item.get("show_on_site", True)) is not bool:
                raise ValueError(f"Invalid show_on_site: {item}")
            if "depth" in item:
                from tfrrs_lists import LIMITS
                if type(item["depth"]) is not int or item["depth"] not in LIMITS:
                    raise ValueError(f"Invalid depth: {item}")
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


def series_key(record):
    """The season list an event's saved days belong to, with the day left off."""
    year, _ = split_year(record["year"])
    return (year, record["season"], record["region"], record["gender"], record["event"])


def split_year(year):
    """A season and its snapshot date: "2025-2026 (2026-01-15)" is ("2025-2026", "2026-01-15")."""
    year = year.replace("_", "-")
    match = SNAPSHOT.fullmatch(year)
    return (match[1], match[2]) if match else (year, None)


def validate_records(records):
    if not isinstance(records, list) or not records:
        raise ValueError("The archive must hold at least one event record")
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
        year, day = split_year(record["year"])
        if day:
            date.fromisoformat(day)
        if not re.fullmatch(r"\d{4}(?:-\d{4})?", year):
            raise ValueError(f"Invalid year: {record['year']}")
        rankings = record.get("rankings")
        # A saved day may record that an event left the list: its rankings are null from that day on.
        if rankings is None and day:
            continue
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


def merge_records(*batches):
    merged = {}
    for batch in batches:
        for record in validate_records(batch) if batch else []:
            merged[record_key(record)] = record
    return [merged[key] for key in sorted(merged)]


def compact(records):
    """Keep a saved day only when its rankings differ from the last day kept for that event."""
    kept, last = [], {}
    for record in sorted(records, key=lambda r: (series_key(r), split_year(r["year"])[1] or "")):
        _, day = split_year(record["year"])
        if day:
            key = series_key(record)
            if key in last and last[key] == record["rankings"]:
                continue
            last[key] = record["rankings"]
        kept.append(record)
    return sorted(kept, key=record_key)


def expand(records, checked):
    """Every day each event was seen, rebuilt from the days its list changed.

    A list that didn't change is the last one kept. `checked` holds the days each season was
    collected, so a day with no change is still a saved day."""
    stored = defaultdict(list)
    for record in records:
        year, day = split_year(record["year"])
        if day:
            stored[series_key(record)].append((day, record))
    days = []
    for key, entries in stored.items():
        entries.sort(key=lambda item: item[0])
        year, season = key[0], key[1]
        index = 0
        for day in sorted(d for d in checked.get((season, year), ()) if d >= entries[0][0]):
            while index + 1 < len(entries) and entries[index + 1][0] <= day:
                index += 1
            record = entries[index][1]
            if record["rankings"] is not None:
                days.append(dict(record, year=f"{year} ({day})"))
    return sorted(days, key=record_key)


def archive_path(data_dir, season, year):
    return Path(data_dir) / ARCHIVE / season / f"{year}.json"


def load_archive(data_dir=DATA_DIR):
    """The saved lists and the days each season was checked. Never replace a missing archive."""
    folder = Path(data_dir) / ARCHIVE
    paths = sorted(folder.glob("*/*.json"))
    if not paths:
        raise FileNotFoundError(f"No saved seasons in {folder}")
    records, checked = [], {}
    for path in paths:
        saved = json.loads(path.read_text())
        if not isinstance(saved, dict) or not isinstance(saved.get("lists"), list):
            raise ValueError(f"Invalid archive file: {path.name}")
        season, year = saved.get("season"), saved.get("year")
        if (season, year) != (path.parent.name, path.stem):
            raise ValueError(f"Archive file {path} holds {season} {year}")
        days = saved.get("checked", [])
        if not isinstance(days, list) or days != sorted(set(days)):
            raise ValueError(f"Invalid checked days in {path.name}")
        for day in days:
            date.fromisoformat(day)
        if days:
            checked[(season, year)] = days
        for entry in saved["lists"]:
            day = entry.get("date")
            records.append(dict(year=f"{year} ({day})" if day else year, season=season,
                                region=entry.get("region"), gender=entry.get("gender"),
                                event=entry.get("event"), rankings=entry.get("rankings")))
    validate_records(records)
    if len({record_key(r) for r in records}) != len(records):
        raise ValueError("Duplicate saved lists in the archive")
    return sorted(records, key=record_key), checked


def load_records(data_dir=DATA_DIR):
    return load_archive(data_dir)[0]


def load_championships(path=CHAMPIONSHIPS):
    return json.loads(Path(path).read_text())


def championship_for(championships, season, year):
    return (championships or {}).get(season, {}).get(year)


def finished(cfg, today, championships):
    """A season stops being collected two weeks after its championship starts: its lists are final."""
    championship = championship_for(championships, cfg["season"], cfg["year"])
    if not championship:
        return False
    return date.fromisoformat(today) >= date.fromisoformat(championship["start_date"]) + timedelta(days=FINAL_AFTER)


def site_name(season, year, gender, region, kind=None):
    return f"{kind + '-' if kind else ''}{season}-{year}-{gender}-{region}.json"


def cutoff(record):
    """The qualifying spot's mark on one saved list, or None when the list doesn't reach it."""
    entry = interpret_qualification(record)["entry"]
    return entry["time"] if entry is not None else None


def fields_by_event(entries):
    """Each imported event's entries, accepted time and cancelled flag, by (season, year, region, gender, event)."""
    found = {}
    for (season, year), saved in (entries or {}).items():
        generated = {(s["region"], s["gender"]): s["generated"] for s in saved["sources"]}
        for field in saved["fields"]:
            found[(season, year, field["region"], field["gender"], field["event"])] = (
                field["entries"], generated[(field["region"], field["gender"])], saved["cancelled"])
    return found


def derive_files(records, checked, config, championships=None, past=None, entries=None, nationals=None):
    """Everything published from the archive: the archive itself, and the site's files.

    The site loads index.json, then one file per season, gender and region it shows. A season's
    saved days go in a file of their own, loaded when the season dialog opens. `entries` are the
    imported accepted lists, which add each event's field as accepted."""
    validate_records(records)
    records = compact(records)
    fields = fields_by_event(entries)
    files = {}
    seasons = defaultdict(list)
    for record in records:
        year, day = split_year(record["year"])
        entry = {"date": day, "region": record["region"], "gender": record["gender"],
                 "event": record["event"], "rankings": record["rankings"]}
        seasons[(record["season"], year)].append(entry)
    for (season, year), entries in sorted(seasons.items()):
        files[f"{ARCHIVE}/{season}/{year}.json"] = {
            "season": season, "year": year, "checked": sorted(checked.get((season, year), [])),
            "lists": entries}

    active_scopes = {(c["year"], c["season"], c["region"]): c for c in config["active"]}
    past_sources = {(c["year"], c["season"], c["region"]): c for c in config.get("historical", [])
                    if (c["year"], c["season"], c["region"]) not in active_scopes and c.get("show_on_site", True)}
    shown = {**past_sources, **active_scopes}
    finals = defaultdict(list)
    for record in records:
        year, day = split_year(record["year"])
        # Outdoor lists are shown by region; the national outdoor list stays in the archive.
        if day is None and (year, record["season"], record["region"]) in shown and not (
                record["season"] == "outdoor" and record["region"] == "National"):
            finals[(record["season"], year, record["gender"], record["region"])].append(record)
    if not any((year, season, region) in active_scopes for season, year, _, region in finals):
        raise ValueError("No configured active standings in the archive")
    days = defaultdict(list)
    for record in expand(records, checked):
        year, day = split_year(record["year"])
        days[(record["season"], year, record["gender"], record["region"], record["event"])].append((day, record))

    index = []
    for (season, year, gender, region), entries in sorted(finals.items()):
        championship = championship_for(championships, season, year)
        start = championship["start_date"] if championship else None
        seen, events, strips = set(), [], {}
        for record in sorted(entries, key=lambda r: r["event"]):
            saved = days.get((season, year, gender, region, record["event"]), [])
            seen.update(day for day, _ in saved)
            before = [(day, item) for day, item in saved if start is None or day < start]
            field = fields.get((season, year, region, gender, record["event"]))
            events.append({
                "event": record["event"],
                "qualification": interpret_qualification(record),
                **({"field": interpret_field(dict(record, year=year), *field)} if field else {}),
                "rankings": record["rankings"],
                # Each saved day before the championship: the date, the qualifying mark, and how many marks the list held.
                "series": [[day, cutoff(item), len(item["rankings"])] for day, item in before],
                "afterMeet": any(start is not None and day >= start for day, _ in saved),
            })
            # Each day's top of the list, kept only on the days it changed, for the race on the season dialog.
            changes, last = [], None
            for day, item in before:
                top = [[row["time"] + (row.get("flag") or ""), row["athlete"]]
                       for row in sorted(item["rankings"], key=lambda r: r["rank"])[:STRIP_ROWS]]
                if top != last:
                    changes.append([day, top])
                    last = top
            if changes:
                strips[record["event"]] = changes
        list_date = max((day for day in seen if start is None or day < start), default=None)
        after = any(start is not None and day >= start for day in seen)
        name = site_name(season, year, gender, region)
        source = shown[(year, season, region)]
        files[f"{SITE}/{name}"] = {
            "season": season, "year": year, "gender": gender, "region": region,
            "championship": championship, "listDate": list_date,
            "final": bool(championship and after and list_date), "events": events}
        if strips:
            files[f"{SITE}/{site_name(season, year, gender, region, 'days')}"] = strips
        index.append({"season": season, "year": year, "gender": gender, "region": region,
                      "current": (year, season, region) in active_scopes, "file": name,
                      "days": site_name(season, year, gender, region, "days") if strips else None,
                      "source": {"list_id": source["list_id"], "list_name": source["list_name"]}})

    saved_finals = {(r["season"], r["year"], r["region"], r["gender"], r["event"]): r["rankings"]
                    for r in records if split_year(r["year"])[1] is None}
    lines = []
    for line in (past or {}).get("lines", []):
        key = tuple(line.get(k) for k in ("season", "year", "region", "gender", "event"))
        if key in fields:
            # A past season's field, from the saved list when the archive holds it and from the entries otherwise.
            record = dict(line, rankings=saved_finals.get(key))
            line = dict(line, field=interpret_field(record, *fields[key], history=True))
        lines.append(line)
    history = {}
    for season in ("indoor", "outdoor"):
        for gender in GENDERS:
            name = f"history-{season}-{gender}.json"
            history[f"{season}-{gender}"] = name
            files[f"{SITE}/{name}"] = {"lines": [line for line in lines
                                                 if line["season"] == season and line["gender"] == gender]}
    files[f"{SITE}/index.json"] = {"lists": index, "history": history}
    add_nationals(files, nationals, records)
    return files


def add_nationals(files, nationals, records):
    """The nationals view: a file per imported season and gender, listed in index.json."""
    files.update(derive_nationals(nationals, records))
    files[f"{SITE}/index.json"]["nationals"] = nationals_index(files)


def encode(value):
    """Compact JSON with one list entry per line, so a day's changes show as a few changed lines."""
    def line(item):
        return json.dumps(item, ensure_ascii=False, separators=(",", ":"))

    def block(items):
        return "[\n" + ",\n".join(line(item) for item in items) + "\n]" if items else "[]"

    if isinstance(value, list):
        return block(value) + "\n"
    parts = [f"{json.dumps(key)}:" + (block(item) if isinstance(item, list) else line(item))
             for key, item in value.items()]
    return "{\n" + ",\n".join(parts) + "\n}\n"


def load_past(data_dir=DATA_DIR):
    path = Path(data_dir) / ARCHIVE / PAST_CUTOFFS
    return json.loads(path.read_text()) if path.exists() else {"lines": []}


def validate_entries(saved, path=None):
    """The shape of an entries file; raises ValueError on anything off."""
    where = f" in {path}" if path else ""
    if not isinstance(saved, dict) or saved.get("season") not in ENTRY_REGIONS:
        raise ValueError(f"Invalid entries file{where}")
    season, year = saved["season"], saved.get("year")
    if not isinstance(year, str) or not re.fullmatch(r"\d{4}-\d{4}" if season == "indoor" else r"\d{4}", year):
        raise ValueError(f"Invalid entries year{where}")
    if path is not None and (Path(path).parent.name, Path(path).stem) != (season, year):
        raise ValueError(f"Entries file {path} holds {season} {year}")
    if type(saved.get("cancelled")) is not bool:
        raise ValueError(f"Invalid cancelled flag{where}")
    sources = saved.get("sources")
    if not isinstance(sources, list) or not sources:
        raise ValueError(f"Missing sources{where}")
    scopes = set()
    for source in sources:
        if (not isinstance(source, dict) or source.get("kind") != "accepted" or source.get("gender") not in GENDERS
                or source.get("region") not in ENTRY_REGIONS[season]
                or not isinstance(source.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", source["sha256"])
                or (source.get("url") is not None and not str(source["url"]).startswith("https://"))
                or (source.get("generated") is not None and not re.fullmatch(
                    r"\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?", str(source["generated"])))
                or (source.get("fetched") is not None and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(source["fetched"])))):
            raise ValueError(f"Invalid source{where}: {source}")
        key = (source["region"], source["gender"])
        if key in scopes:
            raise ValueError(f"Duplicate source{where}: {key}")
        scopes.add(key)
    lists = saved.get("lists")
    if not isinstance(lists, list) or not lists or any(
            not isinstance(item, dict) or item.get("region") not in ENTRY_REGIONS[season]
            or not str(item.get("list_id", "")).isdigit() or type(item.get("depth")) is not int
            for item in lists):
        raise ValueError(f"Invalid lists{where}")
    fields = saved.get("fields")
    if not isinstance(fields, list) or not fields:
        raise ValueError(f"Missing fields{where}")
    seen = set()
    for field in fields:
        if not isinstance(field, dict) or (field.get("region"), field.get("gender")) not in scopes:
            raise ValueError(f"Field without a source{where}: {field.get('event') if isinstance(field, dict) else field}")
        key = (field["gender"], field["region"], field.get("event"))
        if not isinstance(key[2], str) or not key[2] or key in seen:
            raise ValueError(f"Invalid or duplicate field{where}: {key}")
        seen.add(key)
        entries = field.get("entries")
        if not isinstance(entries, list) or not entries:
            raise ValueError(f"Field without entries{where}: {key}")
        ranks = []
        for entry in entries:
            if (not isinstance(entry, dict) or any(not isinstance(entry.get(k), str) or not entry[k].strip()
                                                    for k in ("name", "school", "seed"))
                    or entry.get("match") not in MATCHES):
                raise ValueError(f"Invalid entry{where}: {key}: {entry}")
            rank = entry.get("list_rank")
            if (entry["match"] == "none") != (rank is None) or (rank is not None and (type(rank) is not int or rank < 1)):
                raise ValueError(f"Invalid list rank{where}: {key}: {entry}")
            if "beyond" in entry and (entry["beyond"] is not True or rank is not None):
                raise ValueError(f"Invalid beyond flag{where}: {key}: {entry}")
            row = entry.get("row")
            if row is not None and (rank is None or not isinstance(row, dict) or any(
                    not isinstance(row.get(k), str) or not row[k].strip() for k in ("athlete", "time"))):
                raise ValueError(f"Invalid stored row{where}: {key}: {entry}")
            if rank is not None:
                ranks.append(rank)
        if len(set(ranks)) != len(ranks):
            raise ValueError(f"Two entries share a list rank{where}: {key}")
    return saved


def load_entries(data_dir=DATA_DIR):
    """Every imported season's entries, keyed by (season, year)."""
    found = {}
    for path in sorted((Path(data_dir) / ARCHIVE / ENTRIES).glob("*/*.json")):
        saved = validate_entries(json.loads(path.read_text()), path)
        found[(saved["season"], saved["year"])] = saved
    return found


def publish(records, checked, config, data_dir=DATA_DIR, config_path=None, championships=None):
    """Stage every output before replacing files; roll back replacement failures.

    Site files that are no longer published are removed, so the site never ships a stale list."""
    data_dir = Path(data_dir)
    championships = load_championships() if championships is None else championships
    files = derive_files(records, checked, config, championships, load_past(data_dir), load_entries(data_dir),
                         load_nationals(data_dir))
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
            encoded = json.dumps(value, indent=4) + "\n" if target == config_target else encode(value)
            staged[target] = stage / f"{index}.json"
            staged[target].write_text(encoded, encoding="utf-8")
            originals[target] = target.read_bytes() if target.exists() else None
        stale = [path for path in sorted((data_dir / SITE).glob("*.json")) if path not in staged]
        for path in stale:
            originals[path] = path.read_bytes()
        try:
            for target, source in staged.items():
                if originals[target] == source.read_bytes():
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                os.replace(source, target)
                replaced.append(target)
            for path in stale:
                path.unlink()
                replaced.append(path)
        except OSError:
            for target in reversed(replaced):
                if originals[target] is None:
                    target.unlink()
                else:
                    target.write_bytes(originals[target])
            raise
    return len(replaced)


def mark_conversion(mark, flag=None, stored=None):
    """# is a flat or oversized track; @ is altitude. A mark can carry both."""
    text = f"{mark or ''}{flag or ''}"
    flat = "#" in text
    altitude = "@" in text
    if flat and altitude:
        return "both"
    if flat:
        return "flat"
    if altitude:
        return "altitude"
    if stored in {"flat", "altitude", "both"}:
        return stored
    return None


def split_mark(cell):
    """Return the listed mark, its #/@/(55) flags, and any conversion tooltip."""
    titled = cell.find(attrs={"title": re.compile(r"Converted", re.I)})
    converted = None
    if titled is not None and titled.get("title"):
        converted = re.sub(r"\s+", " ", titled["title"]).strip(" .")
    text = cell.get_text(" ", strip=True)
    flags = MARK_FLAG.findall(text)
    clean = MARK_FLAG.sub(" ", text)
    clean = re.sub(r"\s+", " ", clean).strip()
    return clean, "".join(flags) or None, converted


def list_url(cfg, gender, limit=None):
    limit = limit or cfg.get("depth")
    url = f"https://tf.tfrrs.org/lists/{cfg['list_id']}/{cfg['list_name']}?gender={gender}"
    return f"{url}&limit={limit}" if limit else url


def row_cap(cfg):
    return cfg["depth"] + TIE_MARGIN if cfg.get("depth") else ROW_CAP


def parse_page(html, cfg, gender, cap=None):
    from bs4 import BeautifulSoup

    cap = cap or row_cap(cfg)

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
        rows = table.select("div.performance-list-row")[:cap]
        if not name or not rows:
            raise ValueError("Empty event or rankings")
        rankings = []
        for rank, row in enumerate(rows, 1):
            def cell_for(*labels):
                for label in labels:
                    cell = row.find("div", attrs={"data-label": label})
                    if cell is not None and cell.get_text(strip=True):
                        return cell
                raise ValueError(f"Missing {'/'.join(labels)} in {name}, row {rank}")

            def value_for(*labels):
                return cell_for(*labels).get_text(" ", strip=True)

            # Ties share a Place. Row order stays the fallback when a list has no Place column.
            place_cell = row.find("div", attrs={"data-label": "Place"})
            place_text = place_cell.get_text(" ", strip=True) if place_cell is not None else ""
            place_match = re.search(r"\d+", place_text)
            place = int(place_match.group()) if place_match else rank
            mark_cell = cell_for("Time", "Mark", "Points")
            mark, flag, converted = split_mark(mark_cell)
            # Relay rows identify a school rather than an individual. Field and
            # combined events use Mark/Points; keep the existing JSON time key.
            values = dict(athlete=value_for("Team") if "Relay" in name else value_for("Athlete"),
                          team=value_for("Team"), time=mark, place=place,
                          conversion=mark_conversion(mark, flag))
            if flag:
                values["flag"] = flag
            if converted:
                values["converted"] = converted
            rankings.append(dict(rank=rank, **values))
        records.append(dict(year=cfg["year"], season=cfg["season"], region=cfg["region"],
                            gender=gender, event=name, rankings=rankings))
    validate_records(records)
    if len({record_key(r) for r in records}) != len(records):
        raise ValueError("Duplicate event headings")
    return records


def collect(configs, session=None, sleeper=time.sleep):
    import requests
    from tfrrs_lists import PAUSE, fetch_page, verify_page_identity

    owned_session = session is None
    session = session or requests.Session()
    records = []
    try:
        for cfg in configs:
            for gender in GENDERS:
                print(f"Collecting {cfg['year']} {cfg['season']} {cfg['region']} {gender}", flush=True)
                html = fetch_page(session, list_url(cfg, gender), sleeper)
                verify_page_identity(html, cfg, gender)
                records.extend(parse_page(html, cfg, gender))
                sleeper(PAUSE)
    finally:
        if owned_session:
            session.close()
    return records


def selected(cfg, filters):
    """Whether a list matches every given filter: season, years (championship years) and regions."""
    filters = filters or {}
    return ((not filters.get("season") or cfg["season"] == filters["season"])
            and (not filters.get("years") or cfg["year"].split("-")[-1] in filters["years"])
            and (not filters.get("regions") or cfg["region"] in filters["regions"]))


def run_scrape(mode="active", data_dir=DATA_DIR, config=None, session=None,
               today=None, sleeper=time.sleep, discover=False,
               config_path=ROOT / "scrape_config.json", championships=None, filters=None):
    """Collect one configuration group. `filters` limits which of its lists are collected.

    Historical lists are saved as final lists: they replace the saved final list of each event
    and add no saved day."""
    import requests
    from tfrrs_lists import discover_config

    config = validate_config(config) if config is not None else load_config(config_path)
    if filters and not any(selected(c, filters) for c in config[mode]):
        raise ValueError(f"No {mode} lists match {filters}")
    championships = load_championships() if championships is None else championships
    existing, checked = load_archive(data_dir)
    today = today or datetime.now(timezone.utc).date().isoformat()
    date.fromisoformat(today)
    proposed = config
    owned_session = session is None
    session = session or requests.Session()

    def wanted(cfg):
        # A finished season's lists are final: collecting them again would only repeat them. A list
        # discovery changed is still collected, so it's checked before the change is saved.
        return [c for c in cfg[mode] if selected(c, filters) and (
            mode != "active" or not finished(c, today, championships) or c not in config[mode])]

    try:
        if discover and mode == "active" and config.get("discovery", {}).get("enabled"):
            try:
                proposed = validate_config(discover_config(config, session, sleeper))
            except (requests.RequestException, ValueError) as error:
                print(f"Season discovery unavailable; keeping verified configuration: {error}", flush=True)
        try:
            collected = collect(wanted(proposed), session=session, sleeper=sleeper)
        except (requests.RequestException, ValueError) as error:
            if proposed == config:
                raise
            print(f"New lists are not ready; keeping verified configuration: {error}", flush=True)
            proposed = config
            collected = collect(wanted(config), session=session, sleeper=sleeper)
    finally:
        if owned_session:
            session.close()
    if mode == "active" and not wanted(proposed):
        print("Every active season is finished; no lists to collect", flush=True)
    checked = {key: list(days) for key, days in checked.items()}
    if mode == "active":
        dated = [dict(entry, year=f"{entry['year']} ({today})") for entry in collected]
        # An event that was on a page yesterday and is gone today is marked gone, so its last list
        # isn't carried forward.
        pages = {(split_year(r["year"])[0], r["season"], r["region"], r["gender"]) for r in collected}
        here = {series_key(r) for r in collected}
        last = {}
        for record in sorted(existing, key=lambda r: split_year(r["year"])[1] or ""):
            day = split_year(record["year"])[1]
            if day and day < today:
                last[series_key(record)] = record
        for key, record in last.items():
            if key[:4] in pages and key not in here and record["rankings"] is not None:
                dated.append(dict(record, year=f"{key[0]} ({today})", rankings=None))
        collected += dated
        for season, year in {(r["season"], split_year(r["year"])[0]) for r in collected}:
            checked[(season, year)] = sorted(set(checked.get((season, year), [])) | {today})
    records = compact(merge_records(existing, collected))
    changed = publish(records, checked, proposed, data_dir,
                      config_path=config_path if proposed != config else None,
                      championships=championships)
    if proposed != config:
        print("Saved validated season configuration", flush=True)
    print(f"Validated {len(records)} saved lists; updated {changed} files", flush=True)
    return records
