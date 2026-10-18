"""Inspect and validate season discovery without changing configuration or data."""

import json
import requests

from tfrrs_data import collect, load_config, validate_config
from tfrrs_lists import discover_config


if __name__ == "__main__":
    with requests.Session() as session:
        config = validate_config(discover_config(load_config(), session))
        records = collect(config["active"], session=session)
    print(json.dumps(config["active"], indent=2))
    print(f"Validated {len(records)} events across eight pages; no files changed")
