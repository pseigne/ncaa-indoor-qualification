"""Recover only records actually stored in the selected Git history."""

import argparse
import json
from pathlib import Path
import subprocess

from tfrrs_data import MASTER, ROOT, derive_files, load_config, load_records, publish, record_key, validate_records

MASTER_PATHS = (f"ncaa-qualification/public/data/{MASTER}", f"data/{MASTER}")


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args], text=True)


def recover_records(repo=ROOT, revision="origin/main", include_local=True):
    if git(repo, "rev-parse", "--is-shallow-repository").strip() == "true":
        raise ValueError("Recovery requires full history; run git fetch --unshallow origin")
    revisions = git(repo, "log", "--reverse", "--topo-order", "--format=%H",
                    revision, "--", *MASTER_PATHS).splitlines()
    if not revisions:
        raise ValueError("No master database found in the selected Git history")
    merged = {}
    previous_sources = {}
    for rev in revisions:
        tree = git(repo, "ls-tree", rev, "--", *MASTER_PATHS)
        blobs = {line.split("\t", 1)[1]: line.split()[2] for line in tree.splitlines()}
        # Unchanged records in a stale source are not newer versions. Only
        # actual additions/edits may replace previously recovered records.
        for path in MASTER_PATHS:
            if path not in blobs:
                continue
            blob = blobs[path]
            previous = previous_sources.get(path)
            if previous is None or previous[0] != blob:
                records = validate_records(json.loads(git(repo, "show", blob)))
                current = {record_key(record): record for record in records}
                old = previous[1] if previous else {}
                for key, record in current.items():
                    if old.get(key) != record:
                        merged[key] = record
                previous_sources[path] = (blob, current)
    if include_local:
        for record in load_records(Path(repo) / "data" / MASTER):
            merged[record_key(record)] = record
    return [merged[key] for key in sorted(merged)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", default="origin/main")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    records = recover_records(revision=args.revision)
    config = load_config()
    files = derive_files(records, config)
    print(f"Recovered {len(records)} unique records and {len(files['dates.json'])} snapshot dates")
    if args.dry_run:
        print("Dry run: no data files changed")
    else:
        print(f"Updated {publish(records, config)} files")


if __name__ == "__main__":
    main()
