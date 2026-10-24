"""Regenerate the site's files from the archive."""

from tfrrs_data import compact, load_archive, load_config, publish


def generate_cutoffs():
    records, checked = load_archive()
    changed = publish(compact(records), checked, load_config())
    print(f"Regenerated data; updated {changed} files")


if __name__ == "__main__":
    generate_cutoffs()
