"""Match the NCAA's accepted entries to rows on the saved TFRRS lists.

The NCAA writes "First Last" with abbreviated schools; TFRRS writes "Last,
First" with its own team names. Matching runs in passes, strongest first, and a
row taken by one pass is gone for the next. Anything a pass cannot settle
uniquely is left for the next one, and an entry no pass settles is "none".
"""

import json
from pathlib import Path
import re
import unicodedata

ROOT = Path(__file__).resolve().parent
ALIASES = ROOT / "data" / "archive" / "aliases.json"
# Surname particles that stay with the last name: "Alida Van Daalen" is "Van Daalen, Alida".
PARTICLES = {"van", "von", "de", "der", "den", "da", "das", "del", "della", "di", "do", "dos",
             "du", "la", "le", "st", "st.", "ten", "ter", "el", "al", "mc", "mac"}
SUFFIXES = {"jr", "jr.", "sr", "sr.", "ii", "iii", "iv"}
CONVERTED = re.compile(r"Converted from\s+(\S+)", re.I)
# Older TFRRS lists letter every relay squad, "Texas (B)" for Texas's best team among them.
SQUAD = re.compile(r"\s*\([A-Z]\)$")
# Names at least this long may have been cut by the name column.
NAME_WIDTH = 26


def load_aliases(path=ALIASES):
    path = Path(path)
    if not path.exists():
        return {"schools": {}, "athletes": []}
    aliases = json.loads(path.read_text())
    if not isinstance(aliases.get("schools"), dict) or not isinstance(aliases.get("athletes"), list):
        raise ValueError(f"Invalid aliases file: {path}")
    return aliases


def tfrrs_name(name):
    """ "Alida Van Daalen" is "Van Daalen, Alida"; a lone name is returned as it is."""
    words = name.split()
    if len(words) < 2:
        return name.strip()
    end = len(words)
    if words[-1].casefold() in SUFFIXES and len(words) > 2:
        end -= 1
    start = end - 1
    while start > 1 and words[start - 1].casefold() in PARTICLES:
        start -= 1
    last = " ".join(words[start:])
    return f"{last}, {' '.join(words[:start])}"


def fold(text):
    """Lowercase ASCII words: accents, apostrophes and periods dropped, hyphens as spaces."""
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).casefold()
    text = re.sub(r"[-‐–,/()]", " ", text)
    # Anything else that is not a letter, digit, & or space goes, including stray bytes from
    # pages that were saved in two encodings.
    text = "".join(ch for ch in text if ch.isalnum() or ch in " &")
    return " ".join(text.split())


def school_key(text):
    words = fold(text).replace("&", " & ").split()
    words = ["state" if word == "st" and index else word for index, word in enumerate(words)]
    return " ".join(words)


def same_school(school, team, schools):
    """True when the NCAA's school is this TFRRS team, by name, alias, or a truncated column."""
    team = school_key(team)
    names = {school_key(school)}
    alias = schools.get(school) or schools.get(school.strip())
    if alias:
        names.add(school_key(alias))
    if team in names:
        return True
    # Narrow columns cut long names at 12 characters: "West Virgini".
    return len(school.strip()) >= 12 and any(team.startswith(name) for name in names)


def split_athlete(athlete):
    last, _, first = athlete.partition(",")
    return fold(last).split(), fold(first).split()


def plain(words):
    """German and Nordic spellings without umlauts: "Toernstroem" and "Tornstrom" agree."""
    return [re.sub(r"([aou])e", r"\1", word) for word in words]


def same_surname(name, athlete):
    """The entry's name ends with the row's surname, or shares its last word with it.

    Long names are cut by the page's name column, so a long entry that begins the
    row's full name also counts: "Charlotte Cattermole-William"."""
    words = plain(fold(name).split())
    last, first = (plain(part) for part in split_athlete(athlete))
    if len(words) < 2 or not last:
        return False
    if len(words) > len(last) and words[-len(last):] == last:
        return True
    if words[-1] in last:
        return True
    # Spacing and hyphens differ: "Sysavane" and "Sy-Savane", "St. Peters" and "StPeters".
    if any("".join(words[start:]) == "".join(last) for start in range(1, len(words))):
        return True
    full = " ".join(first + last)
    return len(name) >= NAME_WIDTH and full.startswith(" ".join(words)) and len(words) >= len(first) + 1


def same_first(name, athlete):
    words = plain(fold(name).split())
    _, first = (plain(part) for part in split_athlete(athlete))
    return bool(first) and bool(words) and words[0] == first[0]


def compatible_first(name, athlete):
    """First names that could be the same person: equal, or one begins the other ("Alex", "Alexander")."""
    words = plain(fold(name).split())
    _, first = (plain(part) for part in split_athlete(athlete))
    if not words or not first:
        return False
    return words[0].startswith(first[0]) or first[0].startswith(words[0])


def same_athlete(row, other):
    return fold(row["athlete"]) == fold(other["athlete"]) and school_key(row["team"]) == school_key(other["team"])


def same_squad(row, other):
    """Two relay rows for one school, as when TFRRS lists two of its squads at the same mark."""
    return school_key(SQUAD.sub("", row["team"])) == school_key(SQUAD.sub("", other["team"]))


def clean_mark(text):
    return re.sub(r"[#@]|\(\d+\)", "", text or "").strip().rstrip("m").strip()


def row_marks(row):
    marks = {clean_mark(row.get("time"))}
    converted = CONVERTED.search(row.get("converted") or "")
    if converted:
        marks.add(clean_mark(converted[1]))
    return marks


def _override(entry, overrides, scope, rankings):
    for item in overrides:
        keys = ("season", "year", "gender", "event")
        if any(key in item and (scope is None or str(item[key]) != str(scope.get(key))) for key in keys):
            continue
        if fold(item.get("name")) != fold(entry["name"]):
            continue
        row = next((r for r in rankings if r["rank"] == item.get("list_rank")), None)
        if row is None:
            raise ValueError(f"Athlete alias points at a missing rank: {item}")
        return row
    return None


def match_entries(entries, rankings, aliases, relay=False, scope=None):
    """Each entry's TFRRS row, rank and how it was matched.

    `scope` ({season, year, gender, event}) selects athlete overrides; an
    override that names any of those keys applies only within that scope."""
    schools = aliases.get("schools", {})
    overrides = aliases.get("athletes", [])
    results = [dict(entry=entry, list_rank=None, match="none", row=None) for entry in entries]
    taken = set()

    def settle(label, test, candidates=None, same=same_athlete):
        claims = {}
        for index, result in enumerate(results):
            if result["row"] is not None:
                continue
            hits = [row for row in (candidates(result["entry"]) if candidates else rankings)
                    if row["rank"] not in taken and test(result["entry"], row)]
            # TFRRS sometimes lists one athlete twice with the same mark; the higher row counts.
            if hits and all(same(row, hits[0]) for row in hits):
                best = min(hits, key=lambda row: row["rank"])
                claims.setdefault(best["rank"], []).append((index, best, [row["rank"] for row in hits]))
        for rank, claimants in claims.items():
            if len(claimants) != 1:
                continue
            index, row, ranks = claimants[0]
            results[index].update(list_rank=row["rank"], match=label, row=row)
            taken.update(ranks)

    def manual(entry):
        row = _override(entry, overrides, scope, rankings)
        return [row] if row is not None else []

    settle("manual", lambda entry, row: True, manual)
    if relay:
        settle("exact", lambda e, r: same_school(e["school"], r["team"], schools) and e["seed"] in row_marks(r))
        settle("exact", lambda e, r: (same_school(e["school"], SQUAD.sub("", r["team"]), schools)
                                      and e["seed"] in row_marks(r)), same=same_squad)
        settle("name", lambda e, r: same_school(e["school"], r["team"], schools))
        return results
    settle("exact", lambda e, r: (e["seed"] in row_marks(r) and same_surname(e["name"], r["athlete"])
                                  and same_first(e["name"], r["athlete"])
                                  and same_school(e["school"], r["team"], schools)))
    settle("mark", lambda e, r: e["seed"] in row_marks(r) and same_surname(e["name"], r["athlete"]))
    # The same mark, first name and school with a surname spelled differently: "Crook" and "Crooke".
    settle("mark", lambda e, r: (e["seed"] in row_marks(r) and same_first(e["name"], r["athlete"])
                                 and same_school(e["school"], r["team"], schools)))
    settle("name", lambda e, r: (same_surname(e["name"], r["athlete"]) and same_first(e["name"], r["athlete"])
                                 and same_school(e["school"], r["team"], schools)))
    # Surname and school alone, unless the first names plainly differ (two Jacksons at one school).
    settle("name", lambda e, r: (same_surname(e["name"], r["athlete"]) and compatible_first(e["name"], r["athlete"])
                                 and same_school(e["school"], r["team"], schools)))
    return results


def mark_value(text):
    """Seconds for times, meters or points otherwise."""
    text = clean_mark(text)
    parts = text.split(":")
    try:
        return sum(float(part) * 60 ** power for power, part in enumerate(reversed(parts)))
    except ValueError:
        return None


def higher_is_better(event):
    return re.search(r"jump|vault|put|throw|discus|hammer|javelin|athlon", event, re.I) is not None


def beyond_depth(entry, rankings, event):
    """True when the entry's seed is no better than the last saved row, so it may sit past the list."""
    if not rankings:
        return True
    seed, last = mark_value(entry["seed"]), mark_value(max(rankings, key=lambda r: r["rank"])["time"])
    if seed is None or last is None:
        return False
    return seed <= last if higher_is_better(event) else seed >= last


def report(season, year, cache_dir, data_dir, aliases_path=ALIASES, out=print):
    """Match a season's cached accepted lists against the archive's final lists and print the result."""
    from hytek import parse_performance_list
    from rtspt import INDEX, season_dir
    from tfrrs_data import load_archive

    records, _ = load_archive(data_dir)
    finals = {(r["region"], r["gender"], r["event"]): r["rankings"] for r in records
              if r["season"] == season and r["year"] == year}
    if not finals:
        raise ValueError(f"No final lists in the archive for {season} {year}")
    aliases = load_aliases(aliases_path)
    folder = Path(cache_dir) / season_dir(season, year)
    pages = [p for p in sorted(folder.iterdir()) if p.suffix in (".htm", ".html") and p.name != INDEX]
    if not pages:
        raise ValueError(f"No cached pages in {folder}")
    totals = dict(entries=0, matched=0, unmatched=0, beyond=0)
    for path in pages:
        page = parse_performance_list(path.read_bytes())
        if page["kind"] not in ("accepted", "multi"):
            continue
        out(f"== {path.name}: {page['kind']} {page['region']} ({page['generated']})")
        for event in page["events"]:
            key = (page["region"], event["gender"], event["event"])
            rankings = finals.get(key)
            if rankings is None:
                out(f"   {event['gender']} {event['event']}: no saved list")
                totals["entries"] += len(event["entries"])
                totals["unmatched"] += len(event["entries"])
                continue
            scope = dict(season=season, year=year, gender=event["gender"], event=event["event"])
            results = match_entries(event["entries"], rankings, aliases, relay=event["relay"], scope=scope)
            matched = [r for r in results if r["match"] != "none"]
            missing = [r for r in results if r["match"] == "none"]
            beyond = [r for r in missing if beyond_depth(r["entry"], rankings, event["event"])]
            deepest = max((r["list_rank"] for r in matched), default=None)
            kinds = {label: sum(r["match"] == label for r in results) for label in ("exact", "mark", "name", "manual")}
            out(f"   {event['gender']} {event['event']}: {len(results)} accepted, deepest rank {deepest}, "
                + ", ".join(f"{k} {v}" for k, v in kinds.items() if v)
                + (f", {len(missing) - len(beyond)} unmatched" if len(missing) > len(beyond) else "")
                + (f", {len(beyond)} beyond saved depth ({len(rankings)} rows)" if beyond else ""))
            for result in missing:
                entry = result["entry"]
                tag = "beyond" if result in beyond else "UNMATCHED"
                used = {r["list_rank"] for r in matched}
                near = [f"{r['rank']}:{r['athlete']}/{r['team']}/{r['time']}" for r in rankings
                        if r["rank"] not in used and (
                            entry["seed"] in row_marks(r) or same_surname(entry["name"], r["athlete"]))]
                out(f"      {tag} #{entry['rank']} {entry['name']} ({entry['school']}) {entry['seed']}"
                    + (f"  near: {'; '.join(near[:3])}" if near else ""))
            totals["entries"] += len(results)
            totals["matched"] += len(matched)
            totals["unmatched"] += len(missing) - len(beyond)
            totals["beyond"] += len(beyond)
    out(f"Total: {totals['entries']} entries, {totals['matched']} matched, "
        f"{totals['unmatched']} unmatched, {totals['beyond']} beyond saved depth")
    return totals


def main(argv):
    import argparse

    parser = argparse.ArgumentParser(description="Match cached NCAA accepted lists to the saved TFRRS lists")
    commands = parser.add_subparsers(dest="command", required=True)
    command = commands.add_parser("report")
    command.add_argument("season", choices=["indoor", "outdoor"])
    command.add_argument("year")
    command.add_argument("--cache-dir", default=ROOT / "data" / "entries-cache")
    command.add_argument("--data-dir", default=ROOT / "data")
    command.add_argument("--aliases", default=ALIASES)
    args = parser.parse_args(argv)
    totals = report(args.season, args.year, args.cache_dir, args.data_dir, args.aliases)
    return 1 if totals["unmatched"] else 0


if __name__ == "__main__":
    import sys

    # Isolated runs (python -I) leave the repository off the path.
    sys.path.insert(0, str(ROOT))
    sys.exit(main(sys.argv[1:]))
