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
years are accepted when reading existing data. Current targets remain 2025-26
indoor and 2026 outdoor. The national outdoor source is the NCAA DI national
qualifying list, which includes the combined events; qualification calculations
are unchanged. The old configuration incorrectly pointed some outdoor IDs at
unrelated lists. Those IDs are corrected; saved snapshots are not rewritten.

### Automatic season discovery

Before an active scrape, the monitor reads the public TFRRS homepage and the
season dropdowns at the permanent NCAA DI indoor, outdoor, East, and West URLs.
These sources are configured under `discovery.sources`; it reads published IDs
and titles rather than guessing IDs or incrementing years in URLs. Indoor can
roll over independently. Outdoor advances only when East, West, and National
have a complete matching season. Older targets never replace newer ones, and
years beyond the next calendar year are ignored.

All selected pages must match the actual season, division, region, list ID,
and requested gender and contain valid rankings for both genders. Ambiguous
IDs, unavailable navigation, or new lists with no results retain the last
verified configuration and log the reason. The normal scrape still validates
every existing target and fails if it cannot collect it. Configuration and data
are staged together and rolled back together if saving fails. Replaced active
seasons remain in `historical`, without inventing earlier daily snapshots.

Set `discovery.enabled` to `false` to pin the configured seasons. Manual list
edits still work but must pass the same page identity checks. If TFRRS changes
its navigation or title formats, update discovery and its tests; fallback
messages appear in the Actions log.

## Qualification interpretation

Python owns qualification interpretation. Generated active records, historical
records, and cutoff summaries include `qualification`: `rank` (required list
position), `is_relay`, `status` (`available` or `missing_rank`), and `entry`
(the exact saved ranking or `null`). The authoritative master stays unchanged.
Compatibility summary fields come from the same interpretation; missing ranks
retain the required rank with null cutoff time, athlete, and team.

The website displays this metadata without calculating qualification rules.
Missing or invalid metadata displays “Cutoff unavailable”; missing observations
remain gaps in charts. Rosters remain inspectable. A qualification cutoff is a
saved-list position, not confirmation of championship entry (see GLOSSARY.md).
Regenerate derived files with `python generate_bubble_cutoffs.py` after changing
the interpretation; commit those files together with the code change.

## Scraping and recovery

Use Python 3.12+ and install `pip install -r requirements-dev.txt` in a virtual
environment. Run commands from the repository root:

```sh
python tfrrs-scraper.py             # active lists, both genders, up to 60 rows/event
python discover_seasons.py          # live discovery + eight-page validation, no file edits
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
npm run test:ui
```

The daily action is scheduled at 06:00 UTC and can be run manually. Automated
and manual runs share one concurrency group. Tests and a subpath website build
must pass first; only scheduled or manual runs on `main` scrape and commit data
and any validated season configuration changes in the same commit.
Feature-branch and pull-request runs validate code without publishing.

A successful main-branch scrape triggers the portfolio notification workflow,
which updates `pseigne/website`. The portfolio builds this app and copies root
data into its output. No-op scrapes create no data commit; failed collection,
validation, tests, commit, or push operations report failure. The notification
workflow ignores failed runs and feature branches. Merging a change to `main`
notifies the portfolio only after this repository's validation workflow succeeds.
To request a manual refresh, run Daily TFRRS Scraper on `main`. Check both
repositories' Actions pages after merging.
