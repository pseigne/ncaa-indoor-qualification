"""Validate the source database and every derived JSON file without editing data."""

import json
from pathlib import Path

from tfrrs_data import DATA_DIR, MASTER, derive_files, load_config, load_records, record_key


def validate_data(data_dir=DATA_DIR, config=None):
    data_dir = Path(data_dir)
    records = load_records(data_dir / MASTER)
    if len(records) != len({record_key(r) for r in records}):
        raise ValueError("Duplicate master records; regenerate the database")
    expected = derive_files(records, config or load_config())
    for name, value in expected.items():
        path = data_dir / name
        if path.stat().st_size >= 100 * 1024 * 1024:
            raise ValueError(f"{name} exceeds GitHub's file limit")
        if json.loads(path.read_text()) != value:
            raise ValueError(f"Stale derived data in {name}; run generate_bubble_cutoffs.py")
    print(f"Validated {len(records)} records, {len(expected['dates.json'])} dates, and {len(expected)} JSON files")


if __name__ == "__main__":
    validate_data()
