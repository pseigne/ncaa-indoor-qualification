"""Interpret saved qualifying-list positions without changing source rankings."""

import re


def is_relay(event_name):
    name = event_name.casefold()
    return ("relay" in name or "medley" in name
            or re.search(r"\b4\s*[x×]\s*\d", name) is not None)


def get_cutoff_rank(event_name, season, region):
    relay = is_relay(event_name)
    if season == "indoor":
        return 12 if relay else 16
    name = event_name.casefold()
    combined = "decathlon" in name or "heptathlon" in name
    return 24 if relay or combined or region == "National" else 48


def interpret_qualification(record):
    """Return the required position and its exact saved entry, if present."""
    rank = get_cutoff_rank(record["event"], record["season"], record["region"])
    entry = next((row for row in record["rankings"] if row["rank"] == rank), None)
    return dict(rank=rank, is_relay=is_relay(record["event"]),
                status="available" if entry is not None else "missing_rank",
                entry=dict(entry) if entry is not None else None)
