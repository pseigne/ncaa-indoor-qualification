# NCAA qualification monitor

The React app in `ncaa-qualification/` displays saved TFRRS qualifying lists,
daily progression, and historical cutoffs. GitHub publishes it through the
portfolio at `/ncaa-indoor-qualification/`.

## Data and configuration

`data/tfrrs_historical_data.json` is the authoritative database. The other JSON
files in `data/` contain derived current standings, cutoffs, per-event history,
and a date manifest. Existing legacy JSON files are retained for compatibility.
Event records use compact JSON, one event record per line, to keep the recovered
archive below GitHub's file limit and avoid noisy ranking-by-ranking diffs.
Never edit or commit a separate `ncaa-qualification/public/data/` copy. Vite
serves root data in development and copies it into `dist/data/` during builds.

`scrape_config.json` defines active and historical lists: year, season, region,
TFRRS list ID, and URL slug. Indoor years use `2025-2026`; old underscore-style
years are accepted when reading existing data. Update active lists when a new
season begins; current targets remain 2025-26 indoor and 2026 outdoor.

## Scraping and recovery

Use Python 3.12+ and install `pip install -r requirements-dev.txt` in a virtual
environment. Run commands from the repository root:

```sh
python tfrrs-scraper.py             # active lists, both genders, up to 60 rows/event
python historical-scraper.py        # historical backfill, no new dated snapshots
python generate_bubble_cutoffs.py   # regenerate derived files from root data
python -m unittest discover -s tests -v
python validate_data.py             # check real database and derived files without edits
```

Daily runs use UTC dates. They update current standings and replace only the
matching records for that day, preserving earlier snapshots. Every configured
page must have recognized event tables and nonempty, valid rows. Requests have
timeouts and at most three attempts. Collection and generation finish before
any data is replaced; failures exit nonzero and do not publish partial data.

To recover snapshots that earlier runs dropped, first fetch complete Git history
(`git fetch --unshallow origin` for a shallow clone), then run:

```sh
python recover_history.py --revision origin/main --dry-run
python recover_history.py --revision origin/main
```

Recovery scans both former master-file locations, oldest commit first. The
newest actual record edit wins for each season/date/region/gender/event; the root
copy wins if both sources edit a record within a commit. Unchanged stale copies
cannot overwrite a correction recovered earlier. Current local records are merged
last. Dates are rebuilt only from actual snapshots, never from the old date
manifest. Recovery does not scrape TFRRS or invent missing days.

## Website and publishing

```sh
cd ncaa-qualification
npm ci
npm run dev
npm run build -- --base=/ncaa-indoor-qualification/
npm run test:data
```

The daily action is scheduled at 06:00 UTC and can be run manually. Automated
and manual runs share one concurrency group. Tests and a subpath website build
must pass first; only scheduled or manual runs on `main` scrape and commit data.
Feature-branch and pull-request runs validate code without publishing.

A successful main-branch scrape triggers the portfolio notification workflow,
which updates `pseigne/website`. The portfolio builds this app and copies root
data into its output. No-op scrapes create no data commit; failed collection,
validation, tests, commit, or push operations report failure. The notification
workflow ignores failed runs and feature branches. Merging a change to `main`
notifies the portfolio only after this repository's validation workflow succeeds.
To request a manual refresh, run Daily TFRRS Scraper on `main`. Check both
repositories' Actions pages after merging.
