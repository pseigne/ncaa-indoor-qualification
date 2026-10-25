"""Validate the archive and every published file without editing data."""

import json
from pathlib import Path

from tfrrs_data import (DATA_DIR, SITE, compact, derive_files, load_archive, load_championships,
                        load_config, load_entries, load_past)
from nationals import load_nationals


def validate_data(data_dir=DATA_DIR, config=None, championships=None):
    data_dir = Path(data_dir)
    records, checked = load_archive(data_dir)
    if compact(records) != records:
        raise ValueError("The archive repeats an unchanged saved day; regenerate the data")
    championships = load_championships() if championships is None else championships
    entries = load_entries(data_dir)
    nationals = load_nationals(data_dir)
    expected = derive_files(records, checked, config or load_config(), championships, load_past(data_dir), entries,
                            nationals)
    for name, value in expected.items():
        path = data_dir / name
        if not path.exists() or json.loads(path.read_text()) != value:
            raise ValueError(f"Stale published data in {name}; run generate_bubble_cutoffs.py")
    extra = sorted(str(path.relative_to(data_dir)) for path in (data_dir / SITE).glob("*.json")
                   if str(path.relative_to(data_dir)) not in expected)
    if extra:
        raise ValueError(f"Site files no longer published: {', '.join(extra)}; run generate_bubble_cutoffs.py")
    site = [name for name in expected if name.startswith(f"{SITE}/")]
    print(f"Validated {len(records)} saved lists across {len(checked)} collected seasons, "
          f"{len(entries)} imported seasons of entries, {len(nationals)} of nationals and {len(site)} site files")


if __name__ == "__main__":
    validate_data()
