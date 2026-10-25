"""Interpret saved qualifying-list positions without changing source rankings."""

import re


def is_relay(event_name):
    name = event_name.casefold()
    return ("relay" in name or "medley" in name
            or re.search(r"\b4\s*[x×]\s*\d", name) is not None)


def season_start(year):
    """First calendar year of a season label, ignoring a dated snapshot suffix."""
    if year is None:
        return None
    text = str(year).replace("_", "-").split(" (", 1)[0]
    head = text.split("-", 1)[0]
    return int(head) if len(head) == 4 and head.isdigit() else None


def get_cutoff_rank(event_name, season, region, year=None):
    """Qualifying place for a season.

    Indoor 2009-10 through 2011-12 used automatic standards and a variable
    field, so there is no line (None). Later indoor lists are 16 individuals
    and 12 relays. Outdoor regionals are 48 individuals and 24 relays.
    Combined events, and any national outdoor list, are the top 24.
    2021 regionals were proposed at 32 and then restored to 48 before the meets.
    """
    relay = is_relay(event_name)
    start = season_start(year)
    if season == "indoor":
        if start is not None and start < 2012:
            return None
        return 12 if relay else 16
    name = event_name.casefold()
    combined = "decathlon" in name or "heptathlon" in name
    if relay or combined or region == "National":
        return 24
    return 48


def interpret_qualification(record):
    """Return the required position and its exact saved entry, if present."""
    rank = get_cutoff_rank(record["event"], record["season"], record["region"])
    entry = next((row for row in record["rankings"] if row["rank"] == rank), None)
    return dict(rank=rank, is_relay=is_relay(record["event"]),
                status="available" if entry is not None else "missing_rank",
                entry=dict(entry) if entry is not None else None)


# The list row's mark keys a field entry keeps, so a converted mark still reads as converted.
ROW_KEYS = ("athlete", "team", "time", "flag", "conversion", "converted")


def list_row(row, rank):
    entry = {"rank": rank}
    entry.update((key, row[key]) for key in ROW_KEYS if row.get(key) is not None)
    return entry


def same_row(row, other):
    """One athlete listed twice: TFRRS sometimes repeats a row with the same name and team."""
    return (row.get("athlete", "").casefold() == other.get("athlete", "").casefold()
            and (row.get("team") or "").casefold() == (other.get("team") or "").casefold())


# A relay's second or later squad, as TFRRS names it: "Arkansas (B)". A school enters one team, so these
# can't be entered at all.
SQUAD = re.compile(r"\s*\(([B-Z])\)\s*$")


def squad_school(row):
    """The school a lettered relay squad runs for, or None for a school's own team."""
    name = row.get("team") or row.get("athlete") or ""
    found = SQUAD.search(name)
    return name[:found.start()].casefold() if found else None


def school_of(row):
    name = row.get("team") or row.get("athlete") or ""
    found = SQUAD.search(name)
    return (name[:found.start()] if found else name).casefold()


def interpret_field(record, entries, accepted=None, cancelled=False, history=False):
    """How deep the field as accepted reached on this saved list, and who it took in or left out.

    `entries` are one event's imported entries, each with its `list_rank` (None when unmatched),
    `match`, a stored `row` for seasons without a saved list, and `beyond` when an unmatched seed
    sits past the list. `record["rankings"]` is the saved list, or None for a past season, whose
    rows then come from the entries. `accepted` is the accepted list's generated time, if it had one.
    Ranks are list positions, as in qualification. History lines leave out `in`, `out` and `qualified`.
    `qualified` holds the relay squads lettered B or later whose school's team is in the field: they were
    never eligible, so they aren't out."""
    line = get_cutoff_rank(record["event"], record["season"], record["region"], record.get("year"))
    rankings = record.get("rankings")
    ranks = sorted(entry["list_rank"] for entry in entries if entry["list_rank"] is not None)
    unmatched = sum(entry["list_rank"] is None and not entry.get("beyond") for entry in entries)
    beyond = any(entry["list_rank"] is None and entry.get("beyond") for entry in entries)
    rows = {row["rank"]: row for row in rankings} if rankings is not None else {
        entry["list_rank"]: entry["row"] for entry in entries if entry.get("row") is not None}
    if rankings is not None and ranks and ranks[-1] > max(rows, default=0):
        beyond = True
    status = "unmatched" if unmatched else "beyond_list" if beyond else "available"
    field = dict(status=status, rank=None, size=len(entries),
                 accepted=accepted[:10] if accepted else None, cancelled=bool(cancelled),
                 entry=None, unmatched=unmatched)
    if not history:
        field.update({"in": [], "out": [], "qualified": []})
    if status != "available":
        return field
    rank = ranks[-1]
    if rank not in rows:
        raise ValueError(f"No saved row at {rank} for the {record['event']} field")
    field.update(rank=rank, entry=list_row(rows[rank], rank))
    if not history and line is not None:
        # Out is every place the field passed over, down to the line or past it to the deepest place
        # taken: a place below the line that the field reached past was left open by a scratch too.
        taken = [rows[r] for r in ranks if r in rows]
        field["in"] = [r for r in ranks if r > line]
        passed = [r for r in sorted(rows) if r <= max(line, rank) and r not in ranks
                  and not any(same_row(rows[r], row) for row in taken)]
        # A lettered squad never scratches: its school's own team carries the school's tag.
        squads = {r for r in passed if is_relay(record["event"]) and squad_school(rows[r]) is not None}
        schools = {school_of(row) for row in taken}
        field["out"] = [r for r in passed if r not in squads]
        field["qualified"] = [r for r in passed if r in squads and squad_school(rows[r]) in schools]
    return field
