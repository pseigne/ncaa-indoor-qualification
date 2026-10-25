"""Join each outdoor season's national qualifiers to their regions and results.

    python import_results.py outdoor 2026
    python import_results.py outdoor --from 2018
    python import_results.py outdoor 2019 --offline

The qualifiers are RecordTiming's national qualifier lists, and the decathlon and
heptathlon lists, read through rtspt.py's cache. Each qualifier's region and
list rank come from the First Round accepted lists that import_entries.py has
already matched to the final TFRRS lists. First Round and nationals results
come from Flash Results (flash_results.py, also cached). Anything that can't be
joined for certain is left null and reported; nothing is guessed. Each season
is written to data/archive/nationals/outdoor/{year}.json.
"""

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
# Isolated runs (python -I) leave the repository off the path.
sys.path.insert(0, str(ROOT))

import flash_results  # noqa: E402
from import_entries import NotImportable, accepted_entries, championship_year, read_page  # noqa: E402
from matching import (ALIASES, compatible_first, fold, load_aliases, match_entries, same_school,  # noqa: E402
                      same_surname, school_key, tfrrs_name)
from nationals import EVENT_ORDER, MULTIS, nationals_path, validate_nationals  # noqa: E402
import rtspt  # noqa: E402
from tfrrs_data import DATA_DIR, load_archive, load_entries  # noqa: E402

FIRST_YEAR = 2018
REGIONS = ("East", "West")
LABELS = {"index": "Qualifier lists (RecordTiming)", "East": "East First Round (Flash Results)",
          "West": "West First Round (Flash Results)", "National": "Nationals (Flash Results)"}
QUALIFIER_LABEL = "Qualifier list (RecordTiming)"
MULTI_LABELS = {"Decathlon": "Decathlon list (RecordTiming)", "Heptathlon": "Heptathlon list (RecordTiming)"}


def school_strict(one, other, schools):
    """Two schools as written on two pages are the same name, directly or through an alias either way."""
    ones = {school_key(one), school_key(schools.get(one, one))}
    others = {school_key(other), school_key(schools.get(other, other))}
    return bool(ones & others)


def school_agree(one, other, schools):
    """As school_strict, or a name cut short by a narrow column ("West Virgini")."""
    return (school_strict(one, other, schools) or same_school(one, other, schools)
            or same_school(other, one, schools))


def same_name(entry, other):
    return fold(entry["name"]) == fold(other["name"])


def close_name(entry, other):
    athlete = tfrrs_name(other["name"])
    return same_surname(entry["name"], athlete) and compatible_first(entry["name"], athlete)


def accepted_region(qualifier, fields, relay, schools):
    """The First Round accepted entry this qualifier is: ((region, entry), None), or ((None, None), why).

    Both lists are RecordTiming's, so the strongest test is the same name at the same school; looser
    tests are tried only when it finds nobody."""
    anyone = lambda q, e: True  # noqa: E731
    tests = ([(school_strict, anyone), (school_agree, anyone)] if relay else
             [(school_strict, same_name), (school_agree, same_name), (school_agree, close_name)])
    for school_test, name_test in tests:
        hits = [(region, entry) for region in REGIONS for entry in fields.get(region, [])
                if school_test(qualifier["school"], entry["school"], schools) and name_test(qualifier, entry)]
        if len(hits) == 1:
            return hits[0], None
        if len(hits) > 1:
            return (None, None), f"on {len(hits)} accepted lists ({', '.join(r for r, _ in hits)})"
    return (None, None), "on no First Round accepted list"


def flash_rows(rows, relay, schools):
    """Flash rows as list rows, so match_entries can pair them with the qualifiers."""
    out = []
    for at, row in enumerate(rows, 1):
        school = row["school"] or row["name"] or ""
        team = schools.get(school, school)
        athlete = team if relay else tfrrs_name(row["name"] or "")
        out.append({"rank": at, "athlete": athlete or "?", "team": team or "?", "time": row["mark"] or "",
                    "flash": row})
    return out


def pair(qualifiers, rows, relay, schools, teams=None):
    """Each qualifier's Flash row, by index; unpaired qualifiers are left out.

    Qualifiers are paired under the school RecordTiming writes, then, for those left, under the team
    name of the TFRRS row they were matched to (`teams`, by index), which Flash usually writes in
    full. A pairing needs the schools to agree."""
    plain = {"schools": schools, "athletes": []}
    paired, taken = {}, set()
    for use_team in (False, True):
        todo = [at for at in range(len(qualifiers)) if at not in paired
                and (not use_team or (teams or {}).get(at))]
        free = [row for row in rows if id(row) not in taken]
        if not todo or not free:
            continue
        entries = [dict(qualifiers[at], school=teams[at]) if use_team else qualifiers[at] for at in todo]
        for local, result in enumerate(match_entries(entries, free, plain, relay=relay)):
            row = result["row"]
            # The seed and surname pass ignores schools; a different school is a different athlete.
            if row is None or not school_agree(entries[local]["school"], row["team"], schools):
                continue
            paired[todo[local]] = row
            taken.add(id(row))
    # Last, the surname and school alone, when each side has one candidate: "Emile" and "Emilie Berge".
    names = {at: dict(qualifiers[at], school=(teams or {}).get(at) or qualifiers[at]["school"])
             for at in range(len(qualifiers)) if at not in paired}

    def fits(at, row):
        entry = names[at]
        return (not relay and same_surname(entry["name"], row["athlete"])
                and (school_agree(entry["school"], row["team"], schools)
                     or school_agree(qualifiers[at]["school"], row["team"], schools)))

    free = [row for row in rows if id(row) not in taken]
    for at in names:
        hits = [row for row in free if fits(at, row)]
        if len(hits) == 1 and sum(fits(other, hits[0]) for other in names) == 1:
            paired[at] = hits[0]
    return {at: row["flash"] for at, row in paired.items()}


def first_round_of(row):
    return {"place": row["place"], "mark": row["mark"], "wind": row["wind"], "q": row["q"]}


def nationals_of(athlete):
    return {"round": athlete["round"], "place": athlete["place"], "mark": athlete["mark"],
            "wind": athlete["wind"], "status": athlete["status"], "points": athlete["points"]}


def list_row(region, gender, event, entry, finals):
    """The TFRRS row an accepted entry was matched to: stored with it, or on the saved final list."""
    if entry is None or entry.get("list_rank") is None:
        return None
    if entry.get("row"):
        return entry["row"]
    return next((row for row in finals.get((region, gender, event), []) if row["rank"] == entry["list_rank"]), None)


def join_event(year, gender, event, qualifiers, fields, finals, flash_event, aliases, issues):
    """The archive's qualifiers for one event, and how each was joined to nationals ("id" or "name").

    Every join that fails is added to `issues`."""
    schools = aliases.get("schools", {})
    relay = event.endswith("Relay")
    multi = event in MULTIS
    tag = f"{year} {gender} {event}"

    def who(at):
        return f"{tag}: {qualifiers[at]['name']} ({qualifiers[at]['school']})"

    flash_event = flash_event or {"first_round": {}, "nationals": []}
    count = len(qualifiers)
    regions, accepted, rows = [None] * count, [None] * count, [None] * count
    if multi:
        regions = ["National"] * count
        national = finals.get(("National", gender, event))
        if national:
            # The multis are chosen from the national list, so they rank on it.
            scope = dict(season="outdoor", year=year, gender=gender, event=event)
            for at, result in enumerate(match_entries(qualifiers, national, aliases, scope=scope)):
                rows[at] = result["row"]
                if result["row"] is None:
                    issues.append(f"{who(at)} is not on the national list")
    else:
        for at, qualifier in enumerate(qualifiers):
            (regions[at], accepted[at]), why = accepted_region(qualifier, fields, relay, schools)
            if why:
                issues.append(f"{who(at)} is {why}")
            rows[at] = list_row(regions[at], gender, event, accepted[at], finals)
    teams = {at: row.get("team") or row["athlete"] for at, row in enumerate(rows) if row is not None}

    # First Round results: each region's last round, checked against the accepted list's region.
    first_rounds = {}
    if not multi:
        for region in REGIONS:
            block = flash_event["first_round"].get(region)
            if block is None:
                issues.append(f"{tag}: no {region} First Round results")
                continue
            for at, row in pair(qualifiers, flash_rows(block["rows"], relay, schools), relay, schools, teams).items():
                first_rounds.setdefault(at, {})[region] = row
        for at in range(count):
            found = first_rounds.get(at, {})
            if len(found) > 1:
                issues.append(f"{who(at)} is in both First Rounds' results; kept the accepted list's region")
                found = {regions[at]: found[regions[at]]} if regions[at] in found else {}
                first_rounds[at] = found
            flash_region = next(iter(found), None)
            if regions[at] is None and flash_region is not None:
                issues.append(f"{who(at)}: region {flash_region} from the First Round results only")
                regions[at] = flash_region
            elif flash_region is not None and flash_region != regions[at]:
                issues.append(f"{who(at)}: accepted list says {regions[at]}, First Round results say "
                              f"{flash_region}; region left empty")
                regions[at], rows[at] = None, None
            elif flash_region is None:
                issues.append(f"{who(at)}: not found in the First Round results")
            elif found[flash_region]["q"] is None:
                issues.append(f"{who(at)}: in the {flash_region} First Round results without a Q or q")

    # Nationals: by the TFRRS athlete id Flash gives on both meets, then by name and school.
    entrants = flash_event["nationals"]
    joined, how = {}, {}
    by_id = {}
    for index, athlete in enumerate(entrants):
        if athlete["tfrrs_id"]:
            by_id.setdefault(athlete["tfrrs_id"], []).append(index)
    for at in range(count):
        row = first_rounds.get(at, {}).get(regions[at])
        ids = by_id.get(row["tfrrs_id"]) if row and row["tfrrs_id"] else None
        if ids and len(ids) == 1:
            joined[at], how[at] = ids[0], "id"
    left = [at for at in range(count) if at not in joined]
    free = [index for index in range(len(entrants)) if index not in joined.values()]
    candidates = flash_rows([entrants[index] for index in free], relay, schools)
    found = pair([qualifiers[at] for at in left], candidates, relay, schools,
                 {local: teams[at] for local, at in enumerate(left) if at in teams})
    for local, athlete in found.items():
        joined[left[local]] = free[next(i for i, r in enumerate(candidates) if r["flash"] is athlete)]
        how[left[local]] = "name"
    if entrants:
        for at in range(count):
            if at not in joined:
                issues.append(f"{who(at)} not found in the nationals results")
        for index, athlete in enumerate(entrants):
            if index not in joined.values() and not multi:
                issues.append(f"{tag}: nationals entrant {athlete['name']} ({athlete['school']}) "
                              "is not on the qualifier list")
    else:
        issues.append(f"{tag}: no nationals results")

    out = []
    for at, qualifier in enumerate(qualifiers):
        row = rows[at]
        fr = first_rounds.get(at, {}).get(regions[at]) if regions[at] in REGIONS else None
        result = entrants[joined[at]] if at in joined else None
        if multi:
            rank = row["rank"] if row is not None else None
        else:
            rank = accepted[at]["list_rank"] if accepted[at] is not None and regions[at] is not None else None
        if row is not None:
            team = row.get("team") or row["athlete"]
            name = team if relay else row["athlete"]
        else:
            flash_school = (fr or result or {}).get("school")
            team = (schools.get(qualifier["school"]) or schools.get(flash_school or "", flash_school)
                    or qualifier["school"])
            name = team if relay else tfrrs_name(qualifier["name"])
        if rank is None and (not multi or finals.get(("National", gender, event))):
            issues.append(f"{who(at)} has no list rank")
        tfrrs_id = None if relay else ((fr or {}).get("tfrrs_id") or (result or {}).get("tfrrs_id"))
        out.append({"name": name, "team": team, "school": qualifier["school"], "seed": qualifier["seed"],
                    "region": regions[at], "list_rank": rank, "tfrrs_id": tfrrs_id,
                    "first_round": first_round_of(fr) if fr else None,
                    "nationals": nationals_of(result) if result else None})
    if multi:
        used = {row["rank"] for row in rows if row is not None}
        national = [row for row in finals.get(("National", gender, event)) or [] if row["rank"] not in used]
        out += replacements(year, gender, event, [a for i, a in enumerate(entrants) if i not in joined.values()],
                            national, aliases, issues)
    return out, how


def replacements(year, gender, event, athletes, national, aliases, issues):
    """Decathletes and heptathletes at nationals who are not on the event's list.

    A scratch in the multis is replaced from the national list after the list is posted, so the
    nationals results name the replacement; their seed and rank come from the national list when the
    archive holds it."""
    schools = aliases.get("schools", {})
    out = []
    for athlete in athletes:
        school = athlete["school"] or ""
        row = None
        if national:
            entry = {"name": athlete["name"] or "", "school": school, "seed": ""}
            scope = dict(season="outdoor", year=year, gender=gender, event=event)
            row = match_entries([entry], national, aliases, scope=scope)[0]["row"]
        issues.append(f"{year} {gender} {event}: {athlete['name']} ({school}) added from the nationals results, "
                      f"not on the {event.lower()} list" + ("; not on the national list" if national and not row else ""))
        out.append({"name": row["athlete"] if row else tfrrs_name(athlete["name"] or ""),
                    "team": (row or {}).get("team") or schools.get(school, school), "school": school,
                    "seed": row["time"] if row else None, "region": "National",
                    "list_rank": row["rank"] if row else None, "tfrrs_id": athlete["tfrrs_id"],
                    "first_round": None, "nationals": nationals_of(athlete)})
    return out


def qualifier_pages(year, paths):
    """The season's qualifier lists by gender and its multi lists by event, with their sources."""
    qualifiers, multis, sources = {}, {}, []
    for path in paths:
        body, meta, digest, page = read_page(path)
        if page["kind"] not in ("qualifiers", "multi"):
            continue
        if str(year) not in page["meet"] or "Outdoor" not in page["meet"]:
            raise NotImportable(f"{Path(path).name} is not the {year} outdoor championship: {page['meet']}")
        genders = {event["gender"] for event in page["events"]}
        if len(genders) != 1:
            raise NotImportable(f"{Path(path).name} holds more than one gender")
        gender = genders.pop()
        source = dict(kind=page["kind"], gender=gender, region="National", url=meta.get("url"),
                      generated=page["generated"], fetched=(meta.get("fetched") or "")[:10] or None, sha256=digest)
        if page["kind"] == "qualifiers":
            if gender in qualifiers:
                raise NotImportable(f"Two qualifier lists for {gender}")
            qualifiers[gender] = page
            source["label"] = QUALIFIER_LABEL
        else:
            for event in page["events"]:
                if (gender, event["event"]) in multis:
                    raise NotImportable(f"Two {event['event']} lists")
                multis[(gender, event["event"])] = event
            source["label"] = MULTI_LABELS[page["events"][0]["event"]]
        sources.append({key: value for key, value in source.items() if value is not None})
    missing = [gender for gender in ("m", "f") if gender not in qualifiers]
    if missing:
        raise NotImportable(f"No qualifier list for {', '.join(missing)}")
    return qualifiers, multis, sources


def multi_entries(gender, event, multis, qualifiers, year, issues, schools):
    """The decathlon or heptathlon field: those declared on its own list.

    The multis are the one place a scratch is replaced, so their own list, not the qualifier list,
    has the last word; where the two differ it is reported."""
    listed = multis.get((gender, event))
    on_qualifiers = next((e for e in qualifiers[gender]["events"] if e["event"] == event), None)
    if listed is None:
        if on_qualifiers is None:
            return None
        issues.append(f"{year} {gender} {event}: no {event.lower()} list; using the qualifier list")
        return on_qualifiers["entries"]
    entries = accepted_entries(listed)
    if on_qualifiers is not None:
        def missing(items, others):
            return [e for e in items if not any(same_name(e, o) and school_strict(e["school"], o["school"], schools)
                                                for o in others)]
        for entry in missing(entries, on_qualifiers["entries"]):
            issues.append(f"{year} {gender} {event}: {entry['name']} ({entry['school']}) is on the "
                          f"{event.lower()} list but not the qualifier list")
        for entry in missing(on_qualifiers["entries"], entries):
            issues.append(f"{year} {gender} {event}: {entry['name']} ({entry['school']}) is on the "
                          f"qualifier list but not the {event.lower()} list")
    return entries


def rt_paths(year, cache_dir, offline, session=None):
    if offline:
        folder = Path(cache_dir) / rtspt.season_dir("outdoor", str(year))
        return sorted(p for p in folder.glob("*.htm*") if p.name != rtspt.INDEX and not p.name.endswith(".json"))
    return rtspt.fetch_season("outdoor", str(year), session=session, cache_dir=cache_dir)


def import_season(year, entries_cache=rtspt.CACHE_DIR, results_cache=flash_results.CACHE_DIR, data_dir=DATA_DIR,
                  aliases_path=ALIASES, results_config=None, offline=False, session=None, fetcher=None, out=print):
    """One season's nationals archive and its report: (saved, totals, issues)."""
    year = str(year)
    config = results_config if results_config is not None else flash_results.load_config()
    if year not in config:
        raise NotImportable(f"No Flash Results pages listed for {year} in results_config.json")
    entries = load_entries(data_dir).get(("outdoor", year))
    if entries is None:
        raise NotImportable(f"No imported accepted lists for outdoor {year}; run import_entries.py first")
    fields = {}
    for field in entries["fields"]:
        fields.setdefault((field["gender"], field["event"]), {})[field["region"]] = field["entries"]
    # Saved days carry their date in the year, so only the final lists match it.
    records = [r for r in load_archive(data_dir)[0] if r["season"] == "outdoor" and r["year"] == year]
    finals = {(r["region"], r["gender"], r["event"]): r["rankings"] for r in records}
    qualifiers, multis, page_sources = qualifier_pages(year, rt_paths(year, entries_cache, offline, session))
    if fetcher is None:
        cls = flash_results.CacheOnly if offline else flash_results.Fetcher
        fetcher = cls(cache_dir=results_cache, session=session)
    flash = flash_results.season_results(year, config, fetcher=fetcher)
    flash_events = {(e["gender"], e["event"]): e for e in flash["events"]}
    aliases = load_aliases(aliases_path)
    issues = [f"{year}: Flash page skipped: {item['url']} ({item['reason']})" for item in flash["skipped"]]
    issues += [f"{warning} (Flash)" for warning in flash_results.season_checks(flash)]
    events, totals = [], dict(qualifiers=0, regional=0, region=0, first_round=0, nationals=0, ranked=0,
                              rankable=0, by_id=0)
    for gender in ("f", "m"):
        names = [e["event"] for e in qualifiers[gender]["events"]]
        names += [event for (g, event) in multis if g == gender and event not in names]
        for event in sorted(set(names), key=EVENT_ORDER.index):
            if event in MULTIS:
                listed = multi_entries(gender, event, multis, qualifiers, year, issues, aliases.get("schools", {}))
            else:
                listed = next(e for e in qualifiers[gender]["events"] if e["event"] == event)["entries"]
                if (gender, event) not in fields:
                    issues.append(f"{year} {gender} {event}: no accepted lists imported")
            if len(listed) != 24:
                issues.append(f"{year} {gender} {event}: {len(listed)} qualifiers")
            saved, how = join_event(year, gender, event, listed, fields.get((gender, event), {}), finals,
                                    flash_events.get((gender, event)), aliases, issues)
            events.append({"gender": gender, "event": event, "qualifiers": saved})
            multi = event in MULTIS
            totals["qualifiers"] += len(saved)
            totals["regional"] += 0 if multi else len(saved)
            totals["region"] += sum(q["region"] is not None for q in saved) if not multi else 0
            totals["first_round"] += sum(q["first_round"] is not None for q in saved)
            totals["nationals"] += sum(q["nationals"] is not None for q in saved)
            totals["by_id"] += sum(value == "id" for value in how.values())
            rankable = not multi or bool(finals.get(("National", gender, event)))
            totals["rankable"] += len(saved) if rankable else 0
            totals["ranked"] += sum(q["list_rank"] is not None for q in saved) if rankable else 0
    sources = [{"kind": "index", "region": "National", "label": LABELS["index"],
                "url": f"{rtspt.BASE}{rtspt.season_dir('outdoor', year)}/"}, *page_sources]
    sources += [{"kind": "results", "region": region, "label": LABELS[region], "url": config[year][key]}
                for region, key in (("East", "east"), ("West", "west"), ("National", "nationals"))]
    meet = config[year].get("meet") or {}
    saved = {"season": "outdoor", "year": year,
             "meet": {"name": meet.get("name"), "start_date": meet.get("start_date")},
             "sources": sources, "events": events}
    validate_nationals(saved)
    report(year, totals, issues, out)
    return saved, totals, issues


def percent(part, whole):
    return f"{100 * part / whole:.1f}%" if whole else "n/a"


def report(year, totals, issues, out=print):
    out(f"== outdoor {year}: {totals['qualifiers']} qualifiers; "
        f"region {totals['region']}/{totals['regional']} ({percent(totals['region'], totals['regional'])}), "
        f"First Round {totals['first_round']}/{totals['regional']} ({percent(totals['first_round'], totals['regional'])}), "
        f"nationals {totals['nationals']}/{totals['qualifiers']} ({percent(totals['nationals'], totals['qualifiers'])}; "
        f"{totals['by_id']} by TFRRS id), "
        f"list rank {totals['ranked']}/{totals['rankable']} ({percent(totals['ranked'], totals['rankable'])})")
    for issue in issues:
        out(f"   {issue}")


def encode_nationals(saved):
    """One source or qualifier per line, so a re-import shows as a few changed lines."""
    def line(item):
        return json.dumps(item, ensure_ascii=False, separators=(",", ":"))

    parts = [f'"{key}":{line(saved[key])}' for key in ("season", "year", "meet")]
    parts.append('"sources":[\n' + ",\n".join(line(item) for item in saved["sources"]) + "\n]")
    events = []
    for event in saved["events"]:
        head = line({key: event[key] for key in ("gender", "event")})[:-1]
        events.append(head + ',"qualifiers":[\n' + ",\n".join(line(q) for q in event["qualifiers"]) + "\n]}")
    parts.append('"events":[\n' + ",\n".join(events) + "\n]")
    return "{\n" + ",\n".join(parts) + "\n}\n"


def write_nationals(saved, data_dir=DATA_DIR):
    path = nationals_path(data_dir, saved["year"])
    path.parent.mkdir(parents=True, exist_ok=True)
    text = encode_nationals(saved)
    if json.loads(text) != saved:
        raise ValueError("Nationals file does not read back as written")
    path.write_text(text, encoding="utf-8")
    return path


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("season", choices=["outdoor"])
    parser.add_argument("years", nargs="*", help="outdoor championship years, e.g. 2026")
    parser.add_argument("--from", dest="start", type=int, help="first championship year")
    parser.add_argument("--to", dest="end", type=int, help="last championship year")
    parser.add_argument("--entries-cache", type=Path, default=rtspt.CACHE_DIR)
    parser.add_argument("--results-cache", type=Path, default=flash_results.CACHE_DIR)
    parser.add_argument("--data-dir", type=Path, default=DATA_DIR)
    parser.add_argument("--aliases", type=Path, default=ALIASES)
    parser.add_argument("--config", type=Path, default=flash_results.CONFIG)
    parser.add_argument("--offline", action="store_true", help="read the caches only; fetch nothing")
    parser.add_argument("--dry-run", action="store_true", help="report without writing")
    args = parser.parse_args(argv)
    config = flash_results.load_config(args.config)
    years = list(args.years)
    if args.start is not None:
        end = args.end or max(int(year) for year in config)
        years += [year for year in sorted(config) if args.start <= int(year) <= end and year not in years]
    if not years:
        parser.error("give a year or --from")
    if any(championship_year(year) < FIRST_YEAR for year in years):
        parser.error(f"the qualifier lists begin in {FIRST_YEAR}")
    failed = False
    session = None
    try:
        if not args.offline:
            import requests

            session = requests.Session()
        for year in years:
            try:
                saved, _, _ = import_season(year, args.entries_cache, args.results_cache, args.data_dir, args.aliases,
                                            config, offline=args.offline, session=session)
            except (NotImportable, rtspt.Refused, flash_results.HostBlocked, ValueError) as error:
                print(f"outdoor {year}: {error}", flush=True)
                failed = True
                continue
            if not args.dry_run:
                print(f"Wrote {write_nationals(saved, args.data_dir)}", flush=True)
    finally:
        if session is not None:
            session.close()
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
