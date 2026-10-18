"""Collect configured active qualifying lists without discarding history."""

from tfrrs_data import run_scrape


if __name__ == "__main__":
    run_scrape("active")
