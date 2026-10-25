"""Collect configured historical qualifying lists without discarding history.

    python historical-scraper.py --season outdoor --years 2024,2025,2026 --regions East,West

Only the matching lists are collected again. Years are championship years, so 2026 is
also indoor 2025-2026. Their final lists are replaced; no saved day is added."""

import argparse

from tfrrs_data import run_scrape


def parse_filters(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--season", choices=("indoor", "outdoor"))
    parser.add_argument("--years", help="comma-separated championship years")
    parser.add_argument("--regions", help="comma-separated: National, East, West")
    args = parser.parse_args(argv)
    filters = {}
    if args.season:
        filters["season"] = args.season
    if args.years:
        filters["years"] = {year.strip() for year in args.years.split(",") if year.strip()}
    if args.regions:
        regions = {region.strip().title() for region in args.regions.split(",") if region.strip()}
        if not regions <= {"National", "East", "West"}:
            parser.error(f"unknown region in {args.regions}")
        filters["regions"] = regions
    return filters


if __name__ == "__main__":
    run_scrape("historical", filters=parse_filters())
