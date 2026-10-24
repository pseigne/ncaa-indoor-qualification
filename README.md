# NCAA qualifying lines

The React app in `ncaa-qualification/` shows each saved TFRRS qualifying line
as a heat sheet. Running events also get a race strip, in meters estimated from
average speed, and a season view of how that line moved before the championship.
GitHub publishes it through the portfolio at `/ncaa-indoor-qualification/`.

## Data and configuration

`data/archive/` is the authoritative database: one file per season, such as
`archive/indoor/2025-2026.json`. Each holds the season's final lists, its saved
days, and `checked`, every day the season was collected. A saved day is stored
only when its list changed, so a day with no change is the last one stored; an
event that leaves a list is stored once with `rankings: null`. Rebuilding every
day from the stored changes gives exactly what was collected. A daily scrape
rewrites only the current season's file. `archive/past_cutoffs.json` holds the
qualifying lines of seasons before the saved lists, from `backfill_cutoffs.py`.

`data/site/` is generated from the archive, and it is all the website loads:

- `index.json` lists every season the site shows, by gender and region.
- `{season}-{year}-{gender}-{region}.json` holds one list's events: rankings,
  qualification, each saved day before the championship as `[date, mark,
  marks]`, and whether the list was saved after it began.
- `days-…json` holds each saved day's top 20, stored on the days it changed,
  for the season dialog's race.
- `history-{season}-{gender}.json` holds that season's past cutoffs.

The page loads `index.json`, then the shown list and its past cutoffs, then the
lists a tap away. Files use compact JSON with one entry per line, so a day's
changes show as a few changed lines. Never edit `data/site/` by hand or commit a
separate `ncaa-qualification/public/data/` copy. Vite serves `data/site/` in
development and copies only it into `dist/data/` during builds.

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

Python owns qualification interpretation. Each event in the site's list files
includes `qualification`: `rank` (required list position), `is_relay`, `status`
(`available` or `missing_rank`), and `entry` (the exact saved ranking or
`null`). Each saved day's chart mark comes from the same interpretation and is
`null` when that day's list doesn't reach the required rank. The archive stays
unchanged.

The website displays this metadata without calculating qualification rules.
Missing or invalid metadata displays “Cutoff unavailable”; missing observations
remain gaps in charts. Rosters remain inspectable. A qualification cutoff is a
saved-list position, not confirmation of championship entry (see GLOSSARY.md).
Regenerate the site's files with `python generate_bubble_cutoffs.py` after
changing the interpretation; commit them together with the code change.

### Progression graph end dates

Current progression graphs include only the selected season's dated snapshots,
strictly before the first day of indoor NCAAs or outdoor regional First Rounds
(for both East and West). Meet-day and later snapshots remain saved but are
excluded from the season chart. A season is collected until two weeks after its
championship starts, then left alone: its lists are final. Current rosters stay on the event page.
No missing pre-meet value is invented. This is a pre-meet display
cap, not a claim about the separate performance submission or declaration deadlines.

`ncaa-qualification/src/config/championships.json` stores explicit dates and NCAA
source links by season/year. Dates for 2026–2028 are included. Add or revise an
entry when the NCAA publishes a new schedule; dates are not inferred from the
calendar. If an entry is missing, the graph keeps that season's observations,
labels the championship cutoff date as unavailable, and the season is collected
until discovery replaces it.

## Scraping

Use Python 3.12+ and install `pip install -r requirements-dev.txt` in a virtual
environment. Run commands from the repository root:

```sh
python tfrrs-scraper.py             # active lists, both genders, up to 60 rows/event
python discover_seasons.py          # live discovery + eight-page validation, no file edits
python historical-scraper.py        # historical backfill, no new dated snapshots
python generate_bubble_cutoffs.py   # regenerate data/site from the archive
python -m unittest discover -s tests -v
python validate_data.py             # check the archive and data/site without edits
```

Daily runs use UTC dates. They update current standings and replace only the
matching records for that day, preserving earlier snapshots. Every configured
page must have recognized event tables and nonempty, valid rows. Requests have
timeouts and at most three attempts. Collection and generation finish before
any data is replaced; failures exit nonzero and do not publish partial data.

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
which updates `pseigne/website`. The portfolio builds this app, whose build
output includes `data/site/` as `dist/data/`. No-op scrapes create no data commit; failed collection,
validation, tests, commit, or push operations report failure. The notification
workflow ignores failed runs and feature branches. Merging a change to `main`
notifies the portfolio only after this repository's validation workflow succeeds.
To request a manual refresh, run Daily TFRRS Scraper on `main`. Check both
repositories' Actions pages after merging.
