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
