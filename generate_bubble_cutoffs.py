"""Regenerate frontend JSON files from the authoritative root database."""

from tfrrs_data import get_cutoff_rank, load_config, load_records, merge_records, publish


def generate_cutoffs():
    records = merge_records(load_records())
    changed = publish(records, load_config())
    print(f"Regenerated data; updated {changed} files")


if __name__ == "__main__":
    generate_cutoffs()
