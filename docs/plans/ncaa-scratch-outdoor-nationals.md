# Plan: actual field line, 100-deep outdoor lists, regionals to nationals

Status: research and plan only. No code has been written for these features yet.
Researched 2026-10-24 against the 2025 and 2026 championships.

## Decisions so far

- **RecordTiming:** fetch its pages automatically despite its `Disallow: /`
  robots.txt. Keep it polite: at least 3 seconds between requests, back off on
  403/429, send a user agent that names the project, cache every page, and
  fetch only once a season.
- **The field line comes from the accepted lists**, the page published on
  declaration day. Start lists are not used.
- **Backfill to 2015.** Every season from 2015 to 2026 has accepted lists on
  RecordTiming, except outdoor 2020, when the meet was cancelled (see 1.1).
- **The nationals view starts in 2018**, when the qualifier lists begin.
- **Fetched pages stay out of git**, in gitignored caches. Only the parsed
  facts are committed.

## Summary

| Feature | Data source | Fetch method | Size |
|---|---|---|---|
| 1. Actual field line | RecordTiming (the NCAA's entry and timing contractor) accepted lists, 2015–2026 | Polite once-a-season fetch, cached | Medium |
| 2. Outdoor lists 100 deep | TFRRS East/West lists with `limit=100` | Existing daily scrape | Small |
| 3. Regionals to nationals | RecordTiming qualifier lists, plus Flash Results round pages | Polite once-a-season fetch, cached | Large |

The research changed one assumption. The NCAA does not host any accepted or
declared lists itself; its championship pages link to RecordTiming
(`rtspt.com`), and `rtspt.com/robots.txt` disallows all automated access. You
decided to fetch it anyway, so the importer fetches each season's index page
and its linked lists once, under the rules above.

---

## 1. Research findings

### 1.1 Where the official lists are published

The NCAA's championship pages and ncaa.com articles link to RecordTiming under
"Declarations, Start Lists and Results". Each season has its own directory:

- Indoor: `https://www.rtspt.com/ncaa/d1indoorYY/`, for example
  <https://www.rtspt.com/ncaa/d1indoor25/> and <https://www.rtspt.com/ncaa/d1indoor26/>
- Outdoor: `https://www.rtspt.com/ncaa/d1outdoorYY/`, for example
  <https://www.rtspt.com/ncaa/d1outdoor25/> and <https://www.rtspt.com/ncaa/d1outdoor26/>
- `https://www.rtspt.com/ncaa/` redirects to the current season. `d1indoor27`
  returns 404 today.

**Coverage back to 2015.** I checked every index from `d1indoor15` and
`d1outdoor15` to `d1outdoor24` on 2026-10-24, about 3.5 seconds apart.

| Season | Accepted list filenames | National qualifier list |
|---|---|---|
| Indoor 2015–2026 | `*_declared`, `declared_*`, `*_accepted`, `selected_*`, `*_selected`, `*_entry` | n/a (the field line is the national field) |
| Outdoor 2015–2019, 2021–2026 | `east_*_accepted`, `*_declared`, `*_selected`, `e_w_*`, `e_*`, `w_*` | `*_qualifiers` from 2018; `m_/w_qualifiers` in 2024 |
| Outdoor 2020 | — (`d1outdoor20/` is 404; the meet was cancelled) | — |

- Indoor 2020 has selected lists and start lists, but the meet was cancelled on
  the eve of competition. Its field line is still a real selection; the site
  should label it "meet cancelled".
- Outdoor 2015–2017 have no qualifier list. Who advanced has to come from each
  First Round's compiled results (`east_res.htm`, `east_compiled.htm`), which
  RecordTiming has for those years.
- `w_` means "women" in some years and "west" in others, so pages are
  classified by their own header text, never by filename. See 3.1.

The ncaa.com articles that link to these pages:

- 2025 indoor qualifiers: <https://www.ncaa.com/news/trackfield-indoor-men/article/2025-03-04/ncaa-division-i-mens-and-womens-indoor-track-and-field-championships>
- 2026 indoor selections: <https://www.ncaa.com/news/trackfield-indoor-women/article/2026-03-03/2026-di-indoor-track-and-field-championships-schedule-selections-how>
- 2026 outdoor First Round: <https://www.ncaa.com/news/trackfield-outdoor-women/article/2026-05-21/2026-ncaa-division-i-mens-and-womens-outdoor-track-and-field>
- 2026 outdoor advancement: <https://www.ncaa.com/news/trackfield-outdoor-women/article/2026-06-01/2026-ncaa-division-i-outdoor-track-and-field-championships>

Each document is an HTML page wrapping a fixed-width HY-TEK Meet Manager
"Performance List" in a `<pre>` block. None of them has a PDF, XLSX or CSV
version (results do have PDFs). The ncaaorg S3 bucket, which allows public
listing, has none of these lists: it holds manuals, schedules and qualifying
criteria only.

**Indoor championships**

| Document | 2025 | 2026 | Contents |
|---|---|---|---|
| Accepted, women / men | [women_accepted.htm](https://www.rtspt.com/ncaa/d1indoor25/women_accepted.htm), [men_accepted.htm](https://www.rtspt.com/ncaa/d1indoor25/men_accepted.htm) | [women_accepted.htm](https://www.rtspt.com/ncaa/d1indoor26/women_accepted.htm), [men_accepted.htm](https://www.rtspt.com/ncaa/d1indoor26/men_accepted.htm) | Per event: rank, "First Last", class, school, seed. 16 per individual event; relays show school, seed and up to 6 runners. Headed "pending medical scratches". 2026 seeds carry a `D` suffix. |
| Coaches review, women / men | [women_review.htm](https://www.rtspt.com/ncaa/d1indoor25/women_review.htm), [men_review.htm](https://www.rtspt.com/ncaa/d1indoor25/men_review.htm) | [women_review.htm](https://www.rtspt.com/ncaa/d1indoor26/women_review.htm), [men_review.htm](https://www.rtspt.com/ncaa/d1indoor26/men_review.htm) | The list past the cut, with each seed suffixed `A` (to be considered), `S` (scratched) or blank (nothing submitted). |

**Outdoor First Rounds (East and West)**

| Document | 2025 (`d1outdoor25/`) | 2026 (`d1outdoor26/`) | Contents |
|---|---|---|---|
| Accepted / declared | [e_w_declared.htm](https://www.rtspt.com/ncaa/d1outdoor25/e_w_declared.htm), `e_m_declared.htm`, `w_w_declared.htm`, [w_m_declared.htm](https://www.rtspt.com/ncaa/d1outdoor25/w_m_declared.htm) | [east_women_accepted.htm](https://www.rtspt.com/ncaa/d1outdoor26/east_women_accepted.htm), `east_men_accepted.htm`, `west_women_accepted.htm`, `west_men_accepted.htm` | 48 per individual event and 24 relays per region. 2026 adds bib numbers. |
| Coaches review | [east_women_review.htm](https://www.rtspt.com/ncaa/d1outdoor25/east_women_review.htm) (+3) | [east_women_entries.htm](https://www.rtspt.com/ncaa/d1outdoor26/east_women_entries.htm) (+3) | A / S / blank status for the full list. |

**Outdoor Championships (Eugene)**

| Document | 2025 | 2026 | Contents |
|---|---|---|---|
| Qualifiers, women / men | [women_qualifiers.htm](https://www.rtspt.com/ncaa/d1outdoor25/women_qualifiers.htm), [men_qualifiers.htm](https://www.rtspt.com/ncaa/d1outdoor25/men_qualifiers.htm) | [women_qualifiers.htm](https://www.rtspt.com/ncaa/d1outdoor26/women_qualifiers.htm), [men_qualifiers.htm](https://www.rtspt.com/ncaa/d1outdoor26/men_qualifiers.htm) | The 24 per event (12 from each First Round), merged and sorted by seed. **No region column.** |
| Multi-event accepted | [dec_declared.htm](https://www.rtspt.com/ncaa/d1outdoor25/dec_declared.htm), `hep_declared.htm` | [dec_accepted.htm](https://www.rtspt.com/ncaa/d1outdoor26/dec_accepted.htm), [hep_accepted.htm](https://www.rtspt.com/ncaa/d1outdoor26/hep_accepted.htm) | Top 24 by points from the national list. |
| Start lists and results | — | `women_start.htm`, `men_start.htm`, `compiled_res.htm/.pdf/.txt`, `scores.pdf`, `east_compiled.pdf`, `west_compiled.pdf` (linked from the [2026 index](https://www.rtspt.com/ncaa/d1outdoor26/)) | Official start lists and results. The 2025 First Round compiled results were HTML; the 2026 ones are PDF only. |

All the links in these tables returned 200 when checked on 2026-10-24.

**Filenames change from year to year.** Indoor 2024 used `women_declared.htm`;
outdoor 2024, 2025 and 2026 each used a different naming scheme. The link text
on the index pages ("athletes accepted", "First Round Declared Athletes",
"Qualifier List", "Coaches review") was the same in 2025 and 2026. So the
importer should not depend on filenames. It reads each saved page's own HY-TEK
header (meet name, generated time, "Performance List") and its event headings.

### 1.2 When the lists come out

From the 2025-26 pre-championships manuals, §1•3:
[indoor](https://ncaaorg.s3.amazonaws.com/championships/sports/crosstrack/d1/indoortf/2025-26D1XTI_PrechampionshipsManual.pdf)
and [outdoor](https://ncaaorg.s3.amazonaws.com/championships/sports/crosstrack/d1/outdoortf/2025-26D1XTO_PrechampionshipsManual.pdf).
The 2024-25 schedule ran one day later.

**Indoor 2026** (meet Mar 13–14):

| When | What |
|---|---|
| Mon Mar 2, 8 p.m. ET | Final list posted; declarations open |
| Tue Mar 3, 2 p.m. ET | Declarations due |
| Tue Mar 3, 5–7 p.m. ET | Review window |
| Tue Mar 3, by 10 p.m. ET | Final participant list |
| Tue Mar 10, 2 p.m. ET | Scratch and replacement deadline |
| Wed Mar 11 | Start lists |

The 2026 accepted pages' own header says they were generated Mar 3 at 4:18 PM.
That is about 10 days before the meet, and a week before the replacement deadline.

**Outdoor 2026** (First Rounds May 27–30; nationals Jun 10–13):

| When | What |
|---|---|
| Wed May 20, 2 p.m. ET | Declarations due |
| Thu May 21, 1 p.m. ET | Accepted First Round lists and the decathlon/heptathlon lists |
| Sun May 24 | Scratches due 2 p.m.; no replacements after 8 p.m. ET |
| Sun May 31, 5 p.m. ET | Nationals qualifiers posted |
| Tue Jun 2, 3 p.m. ET | Final participant list |

The 2026 qualifier pages were generated May 31 at 9:16 AM. Nobody has checked
whether pages are rewritten in place after late scratches. Fetching them
*after* the meet captures whatever their final state is.

### 1.3 Current DI rules

Sources:

- [IP] indoor pre-championships manual, linked above
- [IT] indoor technical manual: <https://ncaaorg.s3.amazonaws.com/championships/sports/crosstrack/d1/indoortf/2025-26D1XTI_TechnicalManual.pdf>
- [OP] outdoor pre-championships manual, linked above
- [OT] outdoor technical manual: <https://ncaaorg.s3.amazonaws.com/championships/sports/crosstrack/d1/outdoortf/2025-26D1XTO_TechnicalManual.pdf>
- [QC26] 2026-27 qualifying criteria: <https://ncaaorg.s3.amazonaws.com/championships/sports/crosstrack/common/2026-27XTF_QualifyingCriteria.pdf>

Page numbers are the printed ones.

**Indoor**
- **Field sizes:** the top 16 *declared* athletes per individual event (including the pentathlon and heptathlon) and 12 relays per event. "The stated maximums are absolute and will not be extended as a result of ties." ([IP] §2•4 p.13; [IT] p.3, Case Study 1 p.18)
- **Declarations:** selection counts declared athletes only, so anyone not declared is passed over and the list moves to the next declared performer ([IP] §2•3 p.12, §2•4 p.13).
- **Late scratches:** after declarations, the committee makes "every appropriate effort … to maintain the desired number of participants in an event (16)" by contacting the coaches of eligible replacements. No one is added after 2 p.m. ET the Tuesday before the meet ([IP] §2•4 p.14).
  - So yes, the field fills down past 16, both at declaration and through late replacements.
  - The accepted list only shows the first of these.
- **Scratches are all-inclusive:** scratching from one event removes the athlete from all their events ([IP] p.14; [IT] Case Study 3 p.19).
- **Ties at the line:** compare second-best marks, then third-best and so on, then the later date of the tying mark, then a coin toss ([IP] pp.13–14).
- **Relays:**
  - One team per school ([IT] p.18).
  - The manual's replacement rule names only "(16)". It does not say whether a scratched relay team is replaced by the 13th team.

**Outdoor**
- **First Rounds:** the top 48 declared per individual event and 24 relays per region. The maximums are absolute, and the same fill-down to 48 applies until 8 p.m. ET the Sunday before ([OP] §2•4 p.16, p.15; [OT] pp.2–3). The manual does not state a refill target for relays.
- **Combined events:** the decathlon and heptathlon are not held at the First Rounds. They take the top 24 declared from the *national* list ([OP] p.16; [OT] p.3).
- **Advancement:** the top 12 per event per site advance, for individuals and relays alike, making fields of 24 ([OP] p.16; [OT] p.3).
- **No replacements at nationals:** a First Round qualifier "cannot be replaced", and "the position vacated by any type of scratch is not filled" ([OP] p.15; [OT] pp.40–41). The combined events are the exception ([OP] p.15).
- **Rule changes:**
  - 2025 to 2026: no selection rule changes; field sizes, tie-breaks and scratch policy match the [2024-25 technical manuals](https://ncaaorg.s3.amazonaws.com/championships/sports/crosstrack/d1/indoortf/2024-25D1XTI_TechnicalManual.pdf).
  - For 2026-27 the committee removed altitude conversions and indoor track-size conversions from all qualifying marks ([QC26] item 11). This matters to the app's conversion flags; see Risks.

**What this means for the app.** The current code already uses the right
lines ([qualification.py](../../qualification.py)):

- indoor: 16 individuals, 12 relays
- outdoor regionals: 48 individuals, 24 relays
- combined events: 24 from the national list

The new "actual field line" is the deepest list rank that actually got in. It
is a different quantity from the qualifying line.

### 1.4 Results sources for the First Rounds and nationals

| Meet | TFRRS | Flash Results |
|---|---|---|
| 2025 East First Round | <https://www.tfrrs.org/results/92620> | <https://flashresults.ncaa.com/Outdoor/2025/FirstRounds/East/index.htm> |
| 2025 West First Round | <https://www.tfrrs.org/results/92621> | <https://flashresults.ncaa.com/Outdoor/2025/FirstRounds/West/index.htm> |
| 2025 Outdoor Championships | <https://www.tfrrs.org/results/92668> | <https://flashresults.ncaa.com/Outdoor/2025/index.htm> |
| 2025 Indoor Championships | <https://www.tfrrs.org/results/90189> | <https://flashresults.ncaa.com/Indoor/2025/index.htm> |
| 2026 East First Round | <https://www.tfrrs.org/results/96716> | <https://www.flashresults.com/2026_Meets/Outdoor/05-27_NCAAEast/index.htm> |
| 2026 West First Round | <https://www.tfrrs.org/results/96717> | <https://www.flashresults.com/2026_Meets/Outdoor/05-27_NCAAWest/index.htm> |
| 2026 Outdoor Championships | <https://www.tfrrs.org/results/96875> | <https://www.flashresults.com/2026_Meets/Outdoor/06-10_NCAA/index.htm> |
| 2026 Indoor Championships | <https://www.tfrrs.org/results/95736> | <https://www.flashresults.com/2026_Meets/Indoor/03-13_NCAA/index.htm> |

The official results are also on RecordTiming, for example `compiled_res.txt`
in <https://www.rtspt.com/ncaa/d1outdoor26/>.

**Flash Results**
- **Format:** static HTML, one table per round (`NNN-R_compiled.htm`), plus `_start.htm` start lists.
- **Fields:** place, name, team, class, mark, wind, heat place, and explicit `Q`/`q` markers (`<span class='q_qual'>`). The caption states the advancement rule.
- **TFRRS link:** each athlete link carries the athlete's TFRRS URL (`stats-href="https://www.tfrrs.org/athletes/8700013/…"`). 20 of 23 athletes on one sampled page had it, and 24 of 24 on another.
- **Gotchas:**
  - Team names are abbreviated.
  - The 2026 nationals index includes exhibition wheelchair events, which need filtering out.
  - The 2025 meets were hosted on `flashresults.ncaa.com`; the 2026 meets on `www.flashresults.com`.
  - Event numbering looked consistent in the meets sampled, but that is not confirmed.
- Parsing is easy.

**TFRRS meet results**
- **Format:** per-event HTML with stable athlete IDs.
- **No markers:** there are no Q/q markers. Qualifiers are only implied by place order.
- **Decoy marks:** results pages emit each mark several times with fake values, hiding all but one with inline CSS. A parser has to drop the hidden cells.
- **List pages are clean:** I checked the TFRRS list pages the app already scrapes (a saved East outdoor list page and the indoor list) and found no decoy styling. The current scraper is unaffected.

**ncaa.com:** the articles are prose, and the championship landing page
redirects to ncaatickets.com. It is not a data source.

### 1.5 robots.txt and terms

| Site | Rule | Effect |
|---|---|---|
| <https://www.rtspt.com/robots.txt> | `User-agent: *` / `Disallow: /` | Fetched anyway, by your decision: once a season, 3+ s apart, cached. |
| <https://www.tfrrs.org/robots.txt> | A comment line only; nothing disallowed, no Crawl-delay | Allowed by robots. But see the terms below. |
| <https://www.flashresults.com/robots.txt> | Blocks `/images/ /documents/ …` and `*.pdf *.csv *print=true*`. `.htm` result pages are allowed. No Crawl-delay. | Allowed for `.htm` pages. `flashresults.ncaa.com/robots.txt` returns an S3 403 (no file). |
| <https://www.ncaa.com/robots.txt> | Generic agents allowed on `/news/`; some named bots blocked site-wide | Not needed as a data source. |
| <https://www.ncaa.org/robots.txt> | Everything allowed, `Crawl-delay: 10` | Only the manuals are needed, from S3. |

**TFRRS terms.** TFRRS pages link in their footer to the FloSports
[Terms of Service](https://www.flosports.tv/terms-of-service/), last modified
July 6, 2026. They cover "all other websites … operated by FloSports" and
forbid using "any robot, spider or other automatic device … to access the
Services for any purpose, including scraping". This applies to the app's
*existing* daily TFRRS scrape, not only to the new work. I'm raising it as an
open question rather than deciding it. None of the plan below adds new
automated TFRRS fetching beyond a deeper `limit` on lists the app already
collects.

### 1.6 How the app gets and stores data today

- **Collection** ([tfrrs_data.py](../../tfrrs_data.py), [tfrrs_lists.py](../../tfrrs_lists.py)):
  - The daily action fetches `https://tf.tfrrs.org/lists/{id}/{slug}?gender={m|f}` for four scopes (indoor National; outdoor East, West, National), parses each event table, and keeps at most 60 rows (`rows[:60]` in `parse_page`).
  - TFRRS serves 50 by default; the list form's `limit` select offers 5–500, including **Top 100**.
  - The saved lists today hold 50–60 rows per event.
  - Discovery reads TFRRS navigation to roll seasons over.
  - A season stops being collected 14 days after its championship starts (`FINAL_AFTER`).
- **Archive** (`data/archive/{season}/{year}.json`):
  - The source of truth.
  - Holds each season's final lists, its saved days (stored only when a list changed), and `checked` days.
  - Rankings rows are `{rank, athlete "Last, First", team, time, place, conversion, flag?, converted?}`. There are no TFRRS athlete IDs.
- **Site files** (`data/site/`, generated by `derive_files`):
  - `index.json` lists every shown list.
  - `{season}-{year}-{g}-{region}.json` holds each event's `qualification`, `rankings`, `series` and `afterMeet`.
  - `days-…json` holds the season dialog's race; `history-…json` holds past cutoffs.
  - Outdoor is shown by region; the national outdoor list stays in the archive.
- **The top-16 line** ([qualification.py](../../qualification.py)): `get_cutoff_rank` returns 16/12 indoor, 48/24 outdoor regional, and 24 for the combined events and national lists. `interpret_qualification` picks the saved row at that rank. The site only displays it ([readQualification](../../ncaa-qualification/src/utils/qualification.js)), and [GLOSSARY.md](../../GLOSSARY.md) already says a qualifying line "does not confirm championship entry".
- **UI:**
  - [EventView.jsx](../../ncaa-qualification/src/components/EventView.jsx) draws the `tr.line` "Qualifying line · top N" row after the line's rank. It shows rows down to `line + 6` and then "Show all N".
  - [BoardView.jsx](../../ncaa-qualification/src/components/BoardView.jsx) lists every line.
  - Routes are in [route.js](../../ncaa-qualification/src/utils/route.js) (`view=event|board`, `detail=season|history`).
- **Championship metadata:** [championships.json](../../ncaa-qualification/src/config/championships.json) holds explicit start dates and sources. Outdoor holds only the First Rounds date.

**What each feature changes**

| Feature | Collection | Archive | Interpretation | Site files | UI |
|---|---|---|---|---|---|
| 1. Field line | New offline importer, no new fetching | New `data/archive/entries/…` plus aliases | New `interpret_field` in `qualification.py` | New `field` object per event | Second line row, hero line, board column |
| 2. 100 deep | `limit=100` and a per-list row cap, East/West only | Outdoor files grow about 2× | None (48 stays the line) | `rankings` longer | Race-strip cap, "Show all 100" |
| 3. Nationals | Offline importer plus a polite Flash fetch | New `data/archive/nationals/outdoor/{year}.json` | Python joins qualifiers to region and list rank | New `nationals-…json`, index entry | New `view=nationals` page and links from regional events |

### 1.7 A quick feasibility check

I parsed the saved 2026 women's indoor accepted page with a throwaway script
(not in the repo) and matched it to the archive's final 2025-26 list on
surname plus seed mark:

- In the seven track events it handled, the field reached list rank 16 to 19.
- In the 200m, 800m and 5000m the field went past 16.
- Only one collision went unresolved: two athletes named Joseph with the same 51.36 in the 400m. Comparing first name and school resolves it.
- The script still needs field-event marks (`1.97mD`), relays and "1 Mile Run" handled.

The matching problem is real but small.

---

## 2. Data model changes

### 2.1 Archive: imported entries (feature 1)

New file `data/archive/entries/{season}/{year}.json`, one per championship
season. It is written only by the importer, and it is authoritative the way
the list archive is.

```json
{
  "season": "indoor", "year": "2025-2026",
  "sources": [
    {"kind": "accepted", "gender": "f", "region": "National",
     "url": "https://www.rtspt.com/ncaa/d1indoor26/women_accepted.htm",
     "generated": "2026-03-03T16:18", "fetched": "2026-10-25", "sha256": "…"}
  ],
  "lists": [{"region": "National", "list_id": "5352", "depth": 100}],
  "fields": [
    {"gender": "f", "region": "National", "event": "200 Meters",
     "entries": [
       {"name": "Adaejah Hodge", "school": "Georgia", "seed": "22.32",
        "list_rank": 1, "match": "mark"},
       {"name": "…", "school": "…", "seed": "22.94", "list_rank": 18, "match": "manual",
        "row": {"athlete": "…", "team": "…", "time": "22.94"}}
     ]}
  ]
}
```

Field notes:

- `event` uses the archive's TFRRS event names.
- `list_rank` is the rank on the season's final TFRRS list. It is `null` when there is no match.
- `match` is one of `exact | mark | name | manual | none`.
- `region` is `National` for indoor and `East`/`West` for outdoor First Rounds.
- Outdoor files add the `dec`/`hep` accepted lists as region `National`.
- `lists` records which TFRRS list the ranks refer to.
- **`row` is stored only for seasons the archive has no lists for (2015 to
  2023 indoor, 2015 to 2023 outdoor).** It holds the matched TFRRS row, so the
  site can show the field line without the archive holding those seasons' full
  lists. For 2024 onward, the row comes from the archive.

New file `data/archive/aliases.json`:

- school abbreviations to TFRRS team names, e.g. `"FL State": "Florida State"`, `"TX A&M": "Texas A&M"`, `"Tarleton Sta": "Tarleton State"`
- athlete overrides keyed by `(season, year, gender, event, name)` mapping to a list rank, for the few cases matching can't settle

It is committed, so a re-import gives the same result.

### 2.2 Archive: nationals (feature 3)

New file `data/archive/nationals/outdoor/{year}.json`:

```json
{
  "season": "outdoor", "year": "2026",
  "sources": [ … same shape as above, plus Flash index URLs … ],
  "events": [
    {"gender": "f", "event": "100 Meters",
     "qualifiers": [
       {"name": "Brianna Selby", "school": "USC", "region": "West",
        "list_rank": 2,
        "first_round": {"place": 1, "mark": "10.91", "wind": "+1.2", "q": "Q"},
        "nationals": {"place": 1, "mark": "10.84", "wind": "+0.4", "status": null}}
     ]}
  ]
}
```

- **`region`:** taken from which First Round accepted list the qualifier appears in, using the feature 1 import. Combined events are `National`.
- **`nationals.status`:** `DNS | DNF | DQ | NM | NH | FS` or `null`.
- **`list_rank`:** the qualifier's rank on that region's saved TFRRS list.
- `first_round` and `nationals` are optional, so the view can ship with qualifiers only.

### 2.3 Archive: deeper lists (feature 2)

There is no schema change: rankings rows just go deeper. `scrape_config.json`
entries gain an optional `"depth": 100`, validated as one of TFRRS's `limit`
values. Lists without it keep the current default of 50 with a 60-row cap.

### 2.4 Site files

- **Per event, in each `{season}-{year}-{g}-{region}.json`,** a `field` object next to `qualification`. Python computes it:

  ```json
  "field": {"status": "available", "rank": 19, "size": 16, "source": "accepted",
            "generated": "2026-03-03T16:18",
            "entry": {"rank": 19, "athlete": "…", "team": "…", "time": "…"},
            "in": [17, 19], "out": [6, 12, 14]}
  ```

  - `rank` is the deepest saved-list rank in the field.
  - `in` lists ranks below the qualifying line that got in.
  - `out` lists ranks inside the line that are not in the field (scratched or never declared; the accepted list can't tell which).
  - Other statuses:
    - `missing`: no import for this season
    - `unmatched`: some entries are unmatched, so no line is drawn
    - `beyond_list`: the field reached past the saved depth

  This follows the README's rule that "Python owns qualification interpretation".
- **New file `nationals-outdoor-{year}-{g}.json`**, derived from 2.2 and ready to render.
- **`index.json`** gains `"nationals": [{"season": "outdoor", "year": "2026", "gender": "f", "file": "…"}]`.
- [validate_data.py](../../validate_data.py) and `tests/data.test.js` extend to cover the new files. The existing staged-publish and rollback in `publish()` covers them unchanged, because they flow through `derive_files`.

---

## 3. Importers

### 3.1 `import_entries.py` (features 1 and 3)

1. **Input:** a season and year, for example `python import_entries.py indoor 2025-2026`, or `--from 2015` to backfill a range.
2. **Fetch.**
   - It fetches `https://www.rtspt.com/ncaa/d1{indoor|outdoor}YY/`, then each linked page whose link or filename looks like an entry list (`declared`, `accepted`, `selected`, `entry`, `qualifiers`), skipping review, start and result pages.
   - It waits at least 3 seconds between requests and sends a user agent naming the project.
   - On a 403 or 429 it waits 60 seconds, then 120, and stops after the second refusal, keeping what it has.
   - Every page is cached under `data/entries-cache/` (gitignored, like `data/list-cache/`), so re-runs and parser fixes need no new requests.
   - That is about 3–9 requests per season, roughly 120 for the whole 2015–2026 backfill.
3. **The TFRRS list each season is matched against:**
   - 2024 onward: the archive's final lists.
   - 2015–2023: the final TFRRS lists named in `scrape_config.json` under `archive` (the IDs `backfill_cutoffs.py` already uses), fetched once at `limit=100` into the existing `data/list-cache/`.
   - That is about 54 TFRRS pages for the backfill: 9 indoor seasons plus 8 outdoor seasons × 2 regions, each for both genders.
4. **Identify each page by content, not filename.** It reads the HY-TEK header (meet name, generated timestamp, "Performance List") and the event headings, which tell it the region, gender and kind (accepted, qualifiers, multi). It refuses pages that are not a DI championship list for that season.
5. **Parse the `<pre>` block by event:**
   - Event headings (`Event 17  Women 60 Meter Dash Prelims`) map to archive event names through an alias table. `backfill_cutoffs.py` already has `EVENT_ALIASES` to extend.
   - Individual rows: rank, name, class, school, seed, with the seed's `D`/`A`/`S`/`m` suffixes stripped.
   - Relay rows: school and seed, with runner lines ignored.
6. **Match each entry to the saved final TFRRS list for that scope.** It tries these in order and stops at the first unique hit:
   1. The seed equals the TFRRS mark and the surname matches.
   2. Surname, first name and school (via aliases) match.
   3. Surname and school match.
   4. A manual override applies.

   Relays match on school alone, since there is one team per school.
7. **Write the entries archive file and print a report:**
   - per event: field size, deepest rank, who came in below the line, and who above it is missing
   - every unmatched entry, with suggested aliases
8. **Fail if any expected list is missing or malformed:** indoor needs both genders; outdoor needs East and West for both genders. It also fails if the event count is off from the archive.

### 3.2 `import_results.py` (feature 3)

- **Qualifiers:** from RecordTiming's `*_qualifiers` pages (official, 2018 onward) and the `dec`/`hep` accepted pages, all fetched and cached by 3.1. Region comes from the First Round accepted lists. For 2015–2017 there is no qualifier page, so who advanced comes from the First Round compiled results, which have the Q/q markers.
- **Results:** First Round and nationals places and marks from Flash Results. This is the one place the plan fetches automatically:
  - **URLs:** the Flash index URLs are written into `championships.json` by hand, not guessed.
  - **robots.txt:** it checks robots.txt with `urllib.robotparser` before each host.
  - **Pace:** it waits at least 3 seconds between requests to a host.
  - **On 403 or 429:** it backs off (wait, then a doubled wait) and stops after the second refusal, keeping what it has.
  - **User-Agent:** it sends one that names the project.
  - **Cache:** it caches every page under `data/results-cache/` (gitignored), so re-runs fetch nothing.
  - **Volume:** about 40 events × 3 meets × 2 genders, under 250 requests, once a year.
- **Joining:** Flash's embedded TFRRS athlete URL gives an exact join where present. Otherwise the 3.1 matcher runs on name, school and mark.
- **Exhibition events:** filtered out by name.
- **Alternative:** the official results are on RecordTiming too (`compiled_res.txt`, `east/west_compiled`), and the importer could fetch those instead. But the First Round compiled results are PDF only in 2021, 2023 and 2026, and their HY-TEK text format varies more than Flash's HTML. See open question 7.
- **Flash before 2022:** older meets are on other hosts (`dt8v5llb2dwhs.cloudfront.net` in 2019 and 2021, ncaa.com in 2015–2018, linked from each RecordTiming index). Results before 2022 may need the RecordTiming files instead.

### 3.3 Deeper outdoor lists (feature 2)

- **Collection:** `collect()` appends `&limit={depth}` to the URL when a list has `depth`. `parse_page` takes a `cap` (depth plus a tie margin, e.g. 120) instead of the fixed 60.
- **Identity check:** `verify_page_identity` also checks that the returned `limit` select has the requested value. If TFRRS drops the parameter we fail loudly rather than silently saving 50.
- **Discovery:** discovery-proposed configs keep `depth` from the scope they replace, so next season's East/West lists stay 100 deep.
- **Backfill of finished seasons:** add a `--season outdoor --years 2024,2025,2026 --regions East,West` filter to `historical-scraper.py`. It re-collects those 12 pages once (6 lists × 2 genders) at 3-second spacing. Past dated days stay at 50; only the final lists deepen.

---

## 4. Seasonal runbook

Indoor runs in late March, after the meet. Outdoor runs in late June, after nationals.

**Indoor (e.g. 2026-27, after mid-March)**

1. Make sure the daily scrape has finished the season (14 days after the start date), so the final TFRRS list is in the archive.
2. Run the importer, which fetches the accepted lists:
   ```sh
   python import_entries.py indoor 2026-2027
   ```
3. Read the report, add any school or athlete aliases it suggests to `data/archive/aliases.json`, and run it again until nothing is unmatched. Re-runs read the cache and make no requests.
4. Regenerate, validate and test:
   ```sh
   python generate_bubble_cutoffs.py
   python validate_data.py
   python -m unittest discover -s tests -v
   cd ncaa-qualification && npm run test:data && npm run test:ui
   ```
5. Commit `data/archive/entries/…`, `aliases.json` and `data/site/` together.

**Outdoor (e.g. 2027, after mid-June)**

1. Add the season's Flash Results index URLs (East, West, nationals) and the nationals dates to `championships.json`.
2. Run the importers:
   ```sh
   python import_entries.py outdoor 2027
   python import_results.py outdoor 2027
   ```
   The first fetches the four First Round accepted lists, the two qualifier lists and the decathlon and heptathlon lists. The second fetches the Flash pages. Both cache what they fetch. Resolve aliases as for indoor.
3. Regenerate, validate, test and commit, as for indoor.

**One-time backfill**

```sh
python import_entries.py indoor --from 2015
python import_entries.py outdoor --from 2015
```

This also fetches the 2015–2023 TFRRS final lists once, and is paired with
the feature 2 re-collect of the 2024–2026 East/West final lists. Expect a
couple of rounds of alias fixes, mostly for older school abbreviations. The
README gets a short "End of season" section with these steps.

---

## 5. UI spots

**Event page** ([EventView.jsx](../../ncaa-qualification/src/components/EventView.jsx)), when `field.status === 'available'`:

- **Second line row:** another line row after `field.rank`, styled as a dashed rule in a second accent: "**Field line** · reached 19th after scratches". The existing "Qualifying line · top 16" row stays exactly as it is.
- **Rows:**
  - Rows from 17 to 19 that got in get a small "in" tag.
  - Rows inside 16 that weren't in the field get a muted "not in field" tag. The wording stays neutral, because the accepted list can't distinguish scratched from undeclared.
- **Hero lead:** gets a second sentence: "The field reached 19th: Surname, Team (22.94)."
- **Rows shown:** the visible-rows cap becomes `max(line, field) + 6`.
- **Other statuses:**
  - `missing` and the current season: nothing changes.
  - `unmatched` or `beyond_list`: a short note instead of a line.
- **Outdoor regional pages:** the same treatment around 48 (and 24 for relays). This is where 100-deep lists matter.

**Board** ([BoardView.jsx](../../ncaa-qualification/src/components/BoardView.jsx)): a "Field reached" column (for example "19th · 22.94"), only for seasons with an import.

**Past years dialog** ([PastYears.jsx](../../ncaa-qualification/src/components/PastYears.jsx)):

- The site only shows lists from indoor 2023-24 and outdoor 2024 onward, so the 2015 backfill shows up here.
- Each season's row gets its field line next to its qualifying line, for example "Line 16th · 6.71 — field reached 19th · 6.68".
- The data goes into the `history-{season}-{g}.json` files. Each past line gains a `field` object of the same shape as 2.4.
- 2020 indoor is labeled "meet cancelled"; 2020 outdoor has no field line.

**100-deep outdoor:**

- The table already handles it: rows down to `line + 6` (54), then "Show all 100".
- The race strip currently uses every row ("The top N as one race"). 100 runners would crowd it, so it gets capped (for example at `line + 12`) with the caption updated to match.

**Nationals view (new):**

- **Route:** `view=nationals`, outdoor only, keyed by gender and year (`?g=f&s=outdoor&view=nationals&y=2026&event=100m`).
- **Entry point:** reached from the nav next to "Every qualifying line".
- **Per event:** a heat sheet of the 24 qualifiers, ordered by national place. Columns are place, athlete, team, a region chip (E/W), First Round place and mark with `Q`/`q`, nationals mark and wind. DNS, DNF, DQ and NM go at the bottom.
- **Summary strip:** East vs West qualifiers in the final, and top-8 (All-American) finishers by region.
- **Link from regional pages:** each regional event page gets a card such as "12 went to Eugene: best finish 2nd" linking to it, with the qualifiers' rows tagged in the regional table.
- **Before results are imported:** the view shows qualifiers only.

---

## 6. Risks

- **Fetching rules:**
  - RecordTiming's robots.txt disallows all robots. By your decision the importer fetches it anyway, at low volume and with caching.
    - It could start refusing requests or block the user agent.
    - On a refusal the importer stops and keeps what it has.
    - The cache means a finished season never needs fetching again.
  - Separately, the TFRRS footer's FloSports terms ban automated access. That already applies to the daily scrape (open question 6). The backfill adds about 54 one-time TFRRS list fetches.
- **Pages are HTML, not PDF.** The entry and qualifier lists are fixed-width text in a `<pre>` block, so no PDF parsing is needed for them. PDFs appear only in results: the 2026 First Round compiled results are PDF only, and Flash avoids them.
  - Column widths are fixed but not identical across years. 2026 outdoor added a bib column, and seeds gained `D`/`A`/`S`/`m` suffixes.
  - The parser splits on runs of two or more spaces and reads the right-hand seed, rather than using column offsets.
  - Tests use one saved page per year and kind, trimmed to a few events.
- **Filenames drift.** Pages are identified by their HY-TEK header and title, never by filename.
- **Older seasons:**
  - The 2015–2019 pages may use older HY-TEK layouts, and school abbreviations drift over a decade.
  - The parser gets one trimmed sample page per distinct layout as a test fixture.
  - The TFRRS lists for older seasons may have been corrected since the NCAA froze its list, so more entries may need the name-based match.
- **Matching NCAA names to TFRRS:**
  - NCAA writes "First Last" and abbreviates schools; TFRRS writes "Last, First" with full team names.
  - Seed marks normally equal the TFRRS list mark, which makes a strong key.
  - Risky cases:
    - same surnames at the same mark (seen once in the check above)
    - hyphenated or accented names
    - name changes
    - TFRRS list corrections after the NCAA's list was frozen
    - converted marks (the seed may be the converted mark while TFRRS shows the raw one with a flag)
  - Mitigations:
    - a strict match order
    - a committed alias file
    - a report that lists every non-exact match
    - no line drawn while anything in an event is unmatched
- **Timing:**
  - The accepted list is a snapshot from declaration day. Indoors, replacements go on for a week, so the real field can reach deeper than the accepted page shows.
    - You chose the accepted lists, so the site's wording should say "field as accepted on Mar 3", not imply the final start list.
  - Qualifier pages may be rewritten after scratches. Saving after the meet takes the final state; the saved `generated` timestamp is shown on the site.
  - The importer must run after the season's TFRRS list is final in the archive, so it checks that `finished()` is true.
- **Depth:**
  - Indoor lists are saved about 50 deep. If an indoor field ever reaches past 50, the line shows as `beyond_list`. Raising indoor to 100 is cheap if wanted (open question 5).
  - Outdoor at 100 roughly doubles `data/archive/outdoor/{year}.json`, which is 1.8 MB today. That is still small, but every changed day re-stores deeper rows.
- **Link rot:**
  - The 2025 Flash meets live on `flashresults.ncaa.com`; 2026 is on the main site.
  - Raw pages stay in the gitignored caches with a `sha256` in the archive. Re-imports work offline as long as you keep the cache.
- **2026-27 conversions:** the NCAA removed altitude and track-size conversions. The `#`/`@` flags and conversion notes in the UI may simply stop appearing, and the TFRRS list format may change with them. The deep-list scrape and its identity checks will show whether it does.
- **Side observation, not in scope:** the outdoor East/West lists include a Decathlon table with a line of 24. Combined events actually qualify from the national list, so that regional "line" isn't a real selection line.

---

## 7. Recommended build order

Each step is its own commit (or a few), with tests, and can ship on its own.

1. **Outdoor 100 deep (feature 2).** This is the smallest piece and uses only the existing pipeline:
   - `depth` config
   - `limit` parameter and its check
   - parse cap
   - race-strip cap
   - historical re-collect of the 2024–2026 East/West final lists

   Value: deeper regional lists right away, and it is a prerequisite for a useful outdoor field line.
2. **Indoor field line for 2026, from the accepted lists (feature 1, smallest useful slice):**
   - `import_entries.py` (indoor accepted pages only)
   - `aliases.json`
   - `interpret_field`
   - the `field` site object
   - the second line row and hero sentence on the event page
3. **Indoor 2024 and 2025, plus the board column.** These seasons are shown on the site as lists.
4. **Indoor backfill to 2015, plus field lines in the past years dialog.** This adds the older-layout parsers, the TFRRS `archive` list fetch, and the `history` file `field` objects.
5. **Outdoor First Round field line (48/24) for 2015–2026.** This reuses steps 2–4 with the regional accepted pages, on top of step 1's depth.
6. **Nationals view, qualifiers only:**
   - 2018–2026 from the qualifier pages, plus the region join from step 5
   - the new site file, the `view=nationals` page and links from regional events
7. **Nationals and First Round results** from Flash (`import_results.py`), filling in places and marks.
8. **Optional:** storing TFRRS athlete IDs from list rows (they are linked in the page) for exact joins later.

---

## 8. Open questions for you

1. ~~RecordTiming robots.txt~~ **Decided:** fetch it anyway, politely and with caching.
2. ~~Fetched raw pages~~ **Decided:** kept out of git, in gitignored caches with a `sha256` recorded. Only the parsed facts are committed.
3. ~~Which field counts as "actual"?~~ **Decided:** the accepted lists.
4. ~~How far back?~~ **Decided:** 2015.
   - **Decided:** the nationals view starts in 2018, when the qualifier lists begin. The field lines still go back to 2015.
5. **Indoor depth.** Keep indoor lists at about 50, or take them to 100 too, so the field line can never fall off the saved list?
6. **TFRRS terms of service.** The FloSports terms TFRRS links to ban automated access, which covers the existing daily scrape. Do you want to keep it as is, reduce it, or ask DirectAthletics/FloSports? This plan doesn't change the scrape's scope beyond `limit=100`.
7. **Results source for the nationals view.** Flash Results is my recommendation: automated at 3 or more seconds per request, `.htm` pages allowed by robots, Q/q markers and TFRRS IDs. The alternative is the official RecordTiming results, fetched the same way, but the First Round compiled results are PDF only in some years.
8. **Nationals view scope.** Outdoor only, or also indoor nationals results next to the field line? It would be cheap once step 6 exists.
9. **Wording.** Is "Field line · reached 19th after scratches" right? Should athletes inside 16 who didn't enter be named on the page, or only counted?
10. **Relays.** The manuals don't say whether scratched relay teams are replaced. Should relays show a field line computed the same way, or only individuals?

---

## Sources

- Indoor pre-championships manual 2025-26: <https://ncaaorg.s3.amazonaws.com/championships/sports/crosstrack/d1/indoortf/2025-26D1XTI_PrechampionshipsManual.pdf>
- Indoor technical manual 2025-26: <https://ncaaorg.s3.amazonaws.com/championships/sports/crosstrack/d1/indoortf/2025-26D1XTI_TechnicalManual.pdf>
- Outdoor pre-championships manual 2025-26: <https://ncaaorg.s3.amazonaws.com/championships/sports/crosstrack/d1/outdoortf/2025-26D1XTO_PrechampionshipsManual.pdf>
- Outdoor technical manual 2025-26: <https://ncaaorg.s3.amazonaws.com/championships/sports/crosstrack/d1/outdoortf/2025-26D1XTO_TechnicalManual.pdf>
- Technical manuals 2024-25: <https://ncaaorg.s3.amazonaws.com/championships/sports/crosstrack/d1/indoortf/2024-25D1XTI_TechnicalManual.pdf>, <https://ncaaorg.s3.amazonaws.com/championships/sports/crosstrack/d1/outdoortf/2024-25D1XTO_TechnicalManual.pdf>
- Qualifying criteria: <https://ncaaorg.s3.amazonaws.com/championships/sports/crosstrack/common/2025-26XTF_QualifyingCriteria.pdf>, <https://ncaaorg.s3.amazonaws.com/championships/sports/crosstrack/common/2026-27XTF_QualifyingCriteria.pdf>
- RecordTiming NCAA directories: <https://www.rtspt.com/ncaa/d1indoor25/>, <https://www.rtspt.com/ncaa/d1indoor26/>, <https://www.rtspt.com/ncaa/d1outdoor25/>, <https://www.rtspt.com/ncaa/d1outdoor26/>; robots: <https://www.rtspt.com/robots.txt>
- ncaa.com articles: listed in 1.1
- Flash Results and TFRRS meet pages: listed in 1.4; robots: <https://www.flashresults.com/robots.txt>, <https://www.tfrrs.org/robots.txt>, <https://www.ncaa.com/robots.txt>, <https://www.ncaa.org/robots.txt>
- FloSports Terms of Service (linked from the TFRRS footer): <https://www.flosports.tv/terms-of-service/>

**Not found or not verified:**

- 2024-25 pre-championships manuals (not at the expected S3 paths, and no archived copy)
- whether the RecordTiming pages are rewritten after late scratches
- a Flash First Round field-event or relay page
- whether Flash event numbering is the same across all meets
- the ncaa.org championship landing pages (403 to scripts)

---

## 9. Build interfaces

These are the contracts that the parallel pieces build to. Change one only
together with every piece that uses it.

### 9.1 Shared caches (gitignored, never committed)

| Path | What | Key |
|---|---|---|
| `data/entries-cache/{dir}/{file}` | RecordTiming pages | `dir` is e.g. `d1indoor26`; `file` is the page's own filename |
| `data/list-cache/{list_id}-{gender}-{limit}.html` | TFRRS list pages fetched at a given `limit` | |
| `data/results-cache/{host}/{path}` | Flash Results pages | Mirrors the URL path |

Every fetching module takes a `cache_dir` argument that defaults to these
paths, and reads from the cache before it fetches. Each cache file also gets a
`.meta.json` holding `{url, fetched, status, sha256}`.

**Fetching rules for every module:**

- `requests` with a user agent naming the project
- at least 3 seconds between requests to the same host (a `sleeper` argument, so tests don't wait)
- on a 403 or 429, wait 60 seconds, then 120, then stop for that host, keeping what has been fetched
- timeouts of `(10, 45)`

RecordTiming is fetched despite its robots.txt, by decision. Flash Results and
TFRRS are checked with `urllib.robotparser` first.

### 9.2 Python modules

**`hytek.py`** parses HY-TEK "Performance List" pages:

- `parse_performance_list(html) -> {"meet", "generated" (ISO "YYYY-MM-DDTHH:MM"), "kind", "region", "events": [...]}`
  - `kind` is `accepted | qualifiers | multi | other`.
  - `region` is `East | West | National`, taken from the header and title, never the filename.
  - Each event is `{"gender": "m"|"f", "event": <archive event name>, "relay": bool, "entries": [{"rank", "name" ("First Last"), "class", "school", "seed" (suffixes stripped), "status" ("A"|"S"|"D"|None)}]}`.
  - Relay entries use the school as both `name` and `school`.
- `EVENT_NAMES`: maps HY-TEK event headings to the archive's TFRRS event names, for example `60 Meter Dash` → `60 Meters`, `1 Mile Run` → `Mile`, `4x400 Meter Relay` → `4 x 400 Relay`, `Distance Medley Relay`, and `3000 Meter Steeplechase` → `3000 Steeplechase`. The archive names are those in `ncaa-qualification/src/utils/catalog.js`.

**`matching.py`** matches NCAA entries to TFRRS list rows:

- `match_entries(entries, rankings, aliases, relay=False) -> [{"entry", "list_rank" (int|None), "match" ("exact"|"mark"|"name"|"manual"|"none"), "row" (the TFRRS row or None)}]`
  - `rankings` are archive ranking rows (`athlete` "Last, First", `team`, `time`, `rank`).
  - `aliases` is the loaded `data/archive/aliases.json`: `{"schools": {"FL State": "Florida State", …}, "athletes": [{"season", "year", "gender", "event", "name", "list_rank"}]}`.
- `tfrrs_name(name) -> "Last, First"`.

**`rtspt.py`** fetches RecordTiming:

- `season_dir(season, year)`: indoor `2025-2026` gives `d1indoor26`; outdoor `2026` gives `d1outdoor26`.
- `fetch_season(season, year, session=None, sleeper=time.sleep, cache_dir=…) -> [paths]` fetches the index page, then every linked page that may be an entry list (`declared|accepted|selected|entry|qualifiers`), skipping review, start and result pages.

**`flash_results.py`** fetches and parses Flash Results:

- `parse_round(html) -> {"event", "gender", "round", "rows": [{"place", "name", "school", "mark", "wind", "q" ("Q"|"q"|None), "status" (None|"DNS"|"DNF"|"DQ"|"NM"|"NH"|"FS"), "tfrrs_id" (str|None)}]}`
- `fetch_meet(index_url, …) -> [paths]`, skipping exhibition and wheelchair events.
- The Flash index URLs for each season are listed in a new `results_config.json` at the repository root, keyed by outdoor year: `{"2026": {"east": url, "west": url, "nationals": url, "meet": {"name", "start_date"}}}`.
  - They are not in `championships.json`: adding past seasons there would change the existing site files' `championship` and `final` values.

**`nationals.py`** builds the nationals view's data:

- `derive_nationals(nationals_archive, records) -> {site file name: value}`
- `derive_files` calls it, and adds `index.json["nationals"]`.

### 9.3 Archive files (committed)

- `data/archive/entries/{season}/{year}.json`: as in 2.1.
- `data/archive/aliases.json`: as in 9.2.
- `data/archive/nationals/outdoor/{year}.json`: as in 2.2. Athlete names are stored as `"Last, First"` once matched.

### 9.4 Site contracts

**Per event, in list files: `"field"`**

```
"field": {
  "status": "available" | "unmatched" | "beyond_list",
  "rank": int | null,       // deepest saved-list rank in the field
  "size": int,              // athletes or teams accepted
  "accepted": "YYYY-MM-DD", // the accepted list's generated date
  "cancelled": bool,        // true for indoor 2020: selected, but the meet never ran
  "entry": {"rank", "athlete", "team", "time"} | null,  // the list row at `rank`
  "in": [int],              // ranks below qualification.rank that are in the field
  "out": [int],             // ranks at or inside qualification.rank that are not
  "unmatched": int
}
```

It is omitted when the season has no import. The status is `unmatched` when
`unmatched > 0`, and `beyond_list` when a matched entry's rank is past the
saved rows.

**History lines:** each line in `history-{season}-{g}.json` may carry the same
`field` object, without `in` and `out`.

**Nationals site file `nationals-outdoor-{year}-{g}.json`**

```
{"season": "outdoor", "year": "2026", "gender": "f",
 "meet": {"name": "…", "start_date": "2026-06-10"},
 "sources": [{"label": "…", "url": "…"}],
 "events": [{"event": "100 Meters", "qualifiers": [
   {"athlete": "Selby, Brianna", "team": "USC", "region": "West", "listRank": 2, "seed": "10.83",
    "firstRound": {"place": 1, "mark": "10.91", "wind": "+1.2", "q": "Q"} | null,
    "nationals": {"place": 1, "round": "final", "mark": "10.84", "wind": "+0.4", "status": null, "points": 10} | null}]}]}
```

- **`nationals.round`** is the last round the athlete reached: `final | semifinal | prelim`.
  - `place` is the final place for finalists, and `null` otherwise.
  - `mark`, `wind` and `status` come from that last round.
  - Field events and the multis are a single `final` round.

- `region` is `National` for the decathlon and heptathlon.
- Qualifiers are ordered by national place, then by seed for those without a place.

**`index.json`** gains
`"nationals": [{"season": "outdoor", "year": "2026", "gender": "f", "file": "nationals-outdoor-2026-f.json"}]`.
It is an empty list when there is nothing to show.

---

## 10. As built

All three features are built on `feature/scratch-line`. Where the build
differs from sections 1–9:

**Field line**

- **Coverage:** every indoor season from 2014-15 and every outdoor season from 2015 (no 2020), imported from RecordTiming accepted lists.
- **Unmatched entries:**
  - Outdoor 2016, 2017, 2021, 2022 and 2025 keep a few events `unmatched` or `beyond_list`, where an accepted athlete is on no saved TFRRS list.
  - In 2025 East the cause appears to be that TFRRS's East list leaves out athletes whose seed came from the IC4A/ECAC championships. This was confirmed for 4 of 11 athletes; the rest fit the pattern.
- **`accepted`** is `null` when the HY-TEK page carries no generated stamp, and the page then leaves out "as accepted".
- **`entry`** may carry `flag`, `conversion` and `converted`.
- **Non-`available` statuses** carry `rank: null`, `entry: null`, and empty `in` and `out`.
- **Outdoor multis are left out.** The decathlon and heptathlon are selected from the national list, so the regional pages get no field line for them.
- **Relays get field lines.** Older TFRRS lists letter every relay squad ("Texas (B)"), and the matcher strips the letter.
- **Entries files** gain a top-level `cancelled` (indoor 2019-20) and `beyond: true` on entries past the saved rows.

**Nationals**

- **Coverage:** 2018, 2019 and 2021–2026, by decision.
- **Qualifier lists exist back to 2015** (`*_perf` in 2015–16, `*_q` in 2017), if the view is ever extended.
- **Multis are the one event with replacements.** They come from the multi lists, plus any replacement found only in the results, so they can show 25 rows.
- **2019 men's 400m hurdles** keeps all 25 qualifiers.
- **Points:** Flash Results never shows team points, so `points` is always `null`.
- **Archive keys:** the archive also stores `school` (as RecordTiming writes it), `tfrrs_id` and `meet`.
- **On regional event pages,** a card links to the nationals view and qualifiers are tagged "to nationals".

**Fetching**

- RecordTiming: 104 requests.
- TFRRS: 54 archive-list prefetches plus 12 re-collects at `limit=100`.
- Flash Results: 1,165 pages, one process per host.
- Every request was at least 3 seconds apart, with no 403 or 429. Everything is cached in the gitignored caches in section 9.1.
- The daily TFRRS scrape now also waits 3 seconds between pages and backs off on refusals.

**Name:** the app is now "NCAA TF Qualification Monitor".
