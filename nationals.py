"""The nationals view's data: data/archive/nationals/outdoor/{year}.json to site files.

Each archive file is one outdoor season, written by import_results.py: every
event's national qualifiers with their region, list rank, First Round result
and how they did at nationals. derive_nationals turns them into one site file
per season and gender, nationals-outdoor-{year}-{g}.json, ready to render.
"""

import json
from pathlib import Path
import re

from matching import higher_is_better, mark_value

ARCHIVE = "archive"
NATIONALS = "nationals"
SITE = "site"
GENDERS = ("m", "f")
REGIONS = ("East", "West", "National")
ROUNDS = ("final", "semifinal", "prelim")
STATUSES = ("DNS", "DNF", "DQ", "NM", "NH", "FS")
QS = ("Q", "q")
MULTIS = ("Decathlon", "Heptathlon")
# Meet order, as on the national meet's own index.
EVENT_ORDER = ("100 Meters", "200 Meters", "400 Meters", "800 Meters", "1500 Meters", "5000 Meters",
               "10,000 Meters", "100 Hurdles", "110 Hurdles", "400 Hurdles", "3000 Steeplechase",
               "4 x 100 Relay", "4 x 400 Relay", "High Jump", "Pole Vault", "Long Jump", "Triple Jump",
               "Shot Put", "Discus", "Hammer", "Javelin", "Decathlon", "Heptathlon")
# The season's RecordTiming index and Flash Results meets are shown on the site; the pages read are kept.
SOURCE_KINDS = ("index", "qualifiers", "multi", "results")
SHOWN = ("index", "results")


def site_name(year, gender):
    return f"nationals-outdoor-{year}-{gender}.json"


def nationals_path(data_dir, year):
    return Path(data_dir) / ARCHIVE / NATIONALS / "outdoor" / f"{year}.json"


def _text(value):
    return isinstance(value, str) and bool(value.strip())


def _optional_text(value):
    return value is None or _text(value)


def _place(value):
    return value is None or (type(value) is int and value >= 1)


def validate_nationals(saved, path=None):
    """The shape of a nationals archive file; raises ValueError on anything off."""
    where = f" in {path}" if path else ""
    if not isinstance(saved, dict) or saved.get("season") != "outdoor":
        raise ValueError(f"Invalid nationals file{where}")
    year = saved.get("year")
    if not isinstance(year, str) or not re.fullmatch(r"\d{4}", year):
        raise ValueError(f"Invalid nationals year{where}")
    if path is not None and (Path(path).parent.name, Path(path).stem) != ("outdoor", year):
        raise ValueError(f"Nationals file {path} holds outdoor {year}")
    meet = saved.get("meet")
    if (not isinstance(meet, dict) or not _text(meet.get("name"))
            or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(meet.get("start_date")))):
        raise ValueError(f"Invalid meet{where}")
    sources = saved.get("sources")
    if not isinstance(sources, list) or not sources:
        raise ValueError(f"Missing sources{where}")
    for source in sources:
        if (not isinstance(source, dict) or source.get("kind") not in SOURCE_KINDS
                or source.get("region") not in REGIONS or not _text(source.get("label"))
                or not str(source.get("url", "")).startswith("https://")
                or (source["kind"] in ("qualifiers", "multi") and source.get("gender") not in GENDERS)
                or ("sha256" in source and not re.fullmatch(r"[0-9a-f]{64}", str(source["sha256"])))):
            raise ValueError(f"Invalid source{where}: {source}")
    events = saved.get("events")
    if not isinstance(events, list) or not events:
        raise ValueError(f"Missing events{where}")
    seen = set()
    for event in events:
        if not isinstance(event, dict) or event.get("gender") not in GENDERS or event.get("event") not in EVENT_ORDER:
            raise ValueError(f"Invalid event{where}: {event.get('event') if isinstance(event, dict) else event}")
        key = (event["gender"], event["event"])
        if key in seen:
            raise ValueError(f"Duplicate event{where}: {key}")
        seen.add(key)
        qualifiers = event.get("qualifiers")
        if not isinstance(qualifiers, list) or not qualifiers:
            raise ValueError(f"Event without qualifiers{where}: {key}")
        for qualifier in qualifiers:
            _validate_qualifier(qualifier, event["event"], f"{where}: {key}")
    return saved


def _validate_qualifier(item, event, where):
    if (not isinstance(item, dict) or any(not _text(item.get(k)) for k in ("name", "team", "school"))
            or not _optional_text(item.get("seed"))
            or not (item.get("region") is None or item["region"] in REGIONS)
            or ((item.get("region") == "National") != (event in MULTIS) and item.get("region") is not None)
            or not _place(item.get("list_rank")) or not _optional_text(item.get("tfrrs_id"))):
        raise ValueError(f"Invalid qualifier{where}: {item}")
    first = item.get("first_round")
    if first is not None and (not isinstance(first, dict) or set(first) != {"place", "mark", "wind", "q"}
                              or not _place(first["place"]) or not _optional_text(first["mark"])
                              or not _optional_text(first["wind"]) or first["q"] not in (*QS, None)):
        raise ValueError(f"Invalid First Round result{where}: {item}")
    result = item.get("nationals")
    if result is not None and (
            not isinstance(result, dict) or set(result) != {"round", "place", "mark", "wind", "status", "points"}
            or result["round"] not in ROUNDS or not _place(result["place"])
            or (result["place"] is not None and result["round"] != "final")
            or not _optional_text(result["mark"]) or not _optional_text(result["wind"])
            or result["status"] not in (*STATUSES, None)
            or not (result["points"] is None or (type(result["points"]) in (int, float) and result["points"] > 0))):
        raise ValueError(f"Invalid nationals result{where}: {item}")


def load_nationals(data_dir):
    """Every imported season, keyed by year."""
    found = {}
    for path in sorted((Path(data_dir) / ARCHIVE / NATIONALS / "outdoor").glob("*.json")):
        saved = validate_nationals(json.loads(path.read_text()), path)
        found[saved["year"]] = saved
    return found


def _band(result):
    """Finalists by place, then those out in the semifinal, then the prelims, then statuses, then no result."""
    if result is None:
        return 4
    if result["status"]:
        return 3
    return ROUNDS.index(result["round"])


def order_key(item, event, at):
    result = item["nationals"]
    band = _band(result)
    place = result["place"] if result and band == 0 and result["place"] else float("inf")
    depth = ROUNDS.index(result["round"]) if band == 3 else 0
    seed = mark_value(item["seed"])
    if seed is None:
        seed_key = (1, 0)
    else:
        seed_key = (0, -seed if higher_is_better(event) else seed)
    return (band, place, depth, seed_key, at)


def _final_ranks(records, year):
    """The ranks on each saved final list of the season, by (region, gender, event)."""
    ranks = {}
    for record in records or []:
        if record["season"] == "outdoor" and record["year"] == year:
            ranks[(record["region"], record["gender"], record["event"])] = {row["rank"] for row in record["rankings"]}
    return ranks


def site_qualifier(item):
    first, result = item["first_round"], item["nationals"]
    return {"athlete": item["name"], "team": item["team"], "region": item["region"],
            "listRank": item["list_rank"], "seed": item["seed"],
            "firstRound": dict(first) if first is not None else None,
            "nationals": {key: result[key] for key in ("place", "round", "mark", "wind", "status", "points")}
            if result is not None else None}


def derive_nationals(nationals_archive, records):
    """{site file name: value} for every imported season and gender.

    `nationals_archive` is load_nationals' {year: saved}; `records` are the saved
    lists, against which every list rank of a season the archive holds is checked."""
    files = {}
    for year, saved in sorted((nationals_archive or {}).items()):
        validate_nationals(saved)
        ranks = _final_ranks(records, year)
        labels = [{"label": s["label"], "url": s["url"]} for s in saved["sources"] if s["kind"] in SHOWN]
        sources = list({source["url"]: source for source in labels}.values())
        for gender in GENDERS:
            events = sorted((e for e in saved["events"] if e["gender"] == gender),
                            key=lambda e: EVENT_ORDER.index(e["event"]))
            if not events:
                continue
            out = []
            for event in events:
                for item in event["qualifiers"]:
                    saved_ranks = ranks.get((item["region"], gender, event["event"]))
                    if item["list_rank"] is not None and saved_ranks is not None and item["list_rank"] not in saved_ranks:
                        raise ValueError(f"{year} {gender} {event['event']}: {item['name']} has list rank "
                                         f"{item['list_rank']}, which the saved {item['region']} list does not hold")
                ordered = sorted(enumerate(event["qualifiers"]),
                                 key=lambda pair: order_key(pair[1], event["event"], pair[0]))
                out.append({"event": event["event"], "qualifiers": [site_qualifier(item) for _, item in ordered]})
            files[f"{SITE}/{site_name(year, gender)}"] = {
                "season": "outdoor", "year": year, "gender": gender,
                "meet": {"name": saved["meet"]["name"], "start_date": saved["meet"]["start_date"]},
                "sources": sources, "events": out}
    return files


def nationals_index(files):
    """index.json's "nationals" entries for the nationals site files among `files`."""
    entries = []
    for name, value in sorted(files.items()):
        if name.startswith(f"{SITE}/nationals-"):
            entries.append({"season": value["season"], "year": value["year"], "gender": value["gender"],
                            "file": name[len(SITE) + 1:]})
    return sorted(entries, key=lambda e: (e["year"], e["gender"]), reverse=True)
