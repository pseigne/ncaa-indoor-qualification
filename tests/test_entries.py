import copy
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import Mock, patch

import import_entries
from import_entries import encode_entries, import_season, season_year, seasons, write_entries
from qualification import interpret_field
from tfrrs_data import derive_files, load_entries, validate_entries
from validate_data import validate_data

INDOOR = dict(year="2025-2026", season="indoor", region="National", list_id="5352", list_name="Indoor_List")
CHAMPIONSHIPS = {"indoor": {"2025-2026": {"name": "NCAA indoor championships", "source": "https://example.com",
                                          "start_date": "2026-03-13"}}}
EAST = dict(year="2019", season="outdoor", region="East", list_id="2569", list_name="list")
WEST = dict(year="2019", season="outdoor", region="West", list_id="2570", list_name="list")
COVID = dict(year="2019-2020", season="indoor", region="National", list_id="2770", list_name="list", meet="cancelled")
NO_MEET = dict(year="2020", season="outdoor", region="East", list_id="2910", list_name="list", status="cancelled")
OUTDOOR_CONFIG = {"active": [INDOOR], "historical": [INDOOR],
                  "archive": [EAST, WEST, COVID, NO_MEET, dict(NO_MEET, region="West", list_id="2911")]}
INDOOR_CONFIG = {"active": [INDOOR], "historical": [INDOOR]}
RULE = "=" * 79


def athlete(rank, name, school, seed, cls="SR"):
    return f"{rank:3d}  {name:<30}{cls} {school:<22}{seed}"


def relay(rank, school, seed):
    return f"{rank:3d}  {school:<53}{seed}\n     1) Ann Bee JR                     2) Cy Dee SR"


def hytek(title, events, stamp="HY-TEK's Meet Manager 3/3/2026 04:18 PM", note=""):
    """A HY-TEK performance list: `events` are (heading, relay, rows)."""
    lines = ["Licensed to RecordTiming - Contractor License", f"{'':40}{stamp}", *title, "Performance List", " "]
    for heading, is_relay, rows in events:
        columns = "     School" if is_relay else "     Name                        Year School                 Seed"
        lines += [heading, RULE, columns, RULE, *rows, " "]
    return f"<html><body><p>{note}<pre>\n" + "\n".join(lines) + "\n</pre></body></html>"


def indoor_page(gender="Women", year=2026, extra=()):
    title = [f"NCAA Division I {year} Indoor Championship", f"Example Center - 3/13/{year} to 3/14/{year}"]
    return hytek(title, [
        (f"Event 1  {gender} 60 Meter Dash Prelims", False, [
            athlete(1, "Mara Quill", "Ole Miss", "7.08D"), athlete(2, "Tess Varden", "Tarleton Sta", "7.10D")]),
        (f"Event 2  {gender} 4x400 Meter Relay", True, [relay(1, "Arkansas", "3:25.82D"), relay(2, "TX A&M  'A'", "3:27.01D")]),
        *extra])


def tfrrs(cfg, gender, events, limit=100):
    """A TFRRS list page: `events` map an event name to (athlete, team, mark) rows."""
    title = f"{cfg['year']} NCAA Division I " + (f"{cfg['region']} " if cfg["region"] != "National" else "") + \
        f"{cfg['season'].title()} Qualifying List"
    tables = []
    for name, rows in events.items():
        label = "Points" if name == "Decathlon" else "Mark" if name in ("Hammer", "High Jump") else "Time"
        cells = "".join(f'<div class="performance-list-row"><div data-label="Athlete">{a}</div>'
                        f'<div data-label="Team">{t}</div><div data-label="{label}">{m}</div></div>'
                        for a, t, m in rows)
        tables.append(f'<div class="custom-table-title"><h3>{"Men" if gender == "m" else "Women"}\'s {name}</h3></div>'
                      f'<div class="performance-list">{cells}</div>')
    return (f'<h3 class="panel-title">{title}</h3><form id="list_filter" action="/list_data/{cfg["list_id"]}"></form>'
            f'<select name="gender"><option selected value="{gender}"></option></select>'
            f'<select name="limit"><option value="50"></option><option selected value="{limit}"></option></select>'
            + "".join(tables))


def rows(*items):
    return [dict(rank=rank, athlete=a, team=t, time=m, place=rank, conversion=None)
            for rank, (a, t, m) in enumerate(items, 1)]


SPRINT = rows(("Quill, Mara", "Ole Miss", "7.08"), ("Hale, Ada", "Baylor", "7.09"), ("Varden, Tess", "Tarleton State", "7.10"))
RELAY = rows(("Arkansas", "Arkansas", "3:25.82"), ("Arkansas (B)", "Arkansas (B)", "3:26.81"), ("Texas A&M", "Texas A&M", "3:27.01"))


class Season:
    """A data directory, RecordTiming cache and TFRRS list cache in a temporary folder."""

    def __init__(self, test):
        tmp = tempfile.TemporaryDirectory()
        test.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.data, self.pages, self.lists = self.root / "data", self.root / "entries-cache", self.root / "list-cache"
        self.aliases = self.root / "aliases.json"
        self.aliases.write_text(json.dumps({"schools": {"TX A&M": "Texas A&M"}, "athletes": []}))
        (self.data / "archive" / "indoor").mkdir(parents=True)
        self.archive()

    def archive(self, events=None, year="2025-2026"):
        events = events or {"60 Meters": SPRINT, "4 x 400 Relay": RELAY}
        lists = [dict(date=None, region="National", gender=g, event=name, rankings=r)
                 for g in ("m", "f") for name, r in events.items()]
        (self.data / "archive" / "indoor" / f"{year}.json").write_text(json.dumps(
            {"season": "indoor", "year": year, "checked": [], "lists": lists}))

    def page(self, directory, name, html, links=None):
        folder = self.pages / directory
        folder.mkdir(parents=True, exist_ok=True)
        body = html.encode("cp1252")
        (folder / name).write_bytes(body)
        url = f"https://www.rtspt.com/ncaa/{directory}/{name}"
        (folder / f"{name}.meta.json").write_text(json.dumps(
            {"url": url, "fetched": "2026-10-24", "status": 200, "sha256": hashlib.sha256(body).hexdigest()}))
        index = folder / "index.html"
        names = json.loads(index.with_suffix(".names").read_text()) if index.with_suffix(".names").exists() else []
        names.append([name, links or "athletes accepted"])
        index.with_suffix(".names").write_text(json.dumps(names))
        index.write_text("<html><body>" + "".join(f'<a href="{n}">{t}</a>' for n, t in names) + "</body></html>")

    def run(self, season="indoor", year="2025-2026", config=INDOOR_CONFIG, today="2026-04-01"):
        lines = []
        saved, totals = import_season(season, year, self.pages, self.lists, self.data, self.aliases, config,
                                      CHAMPIONSHIPS, today, session=self.session(), out=lines.append)
        return saved, totals, "\n".join(lines)

    def session(self):
        session = Mock()
        session.get.side_effect = AssertionError("no requests: every page is cached")
        return session


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.season = Season(self)
        self.season.page("d1indoor26", "women_accepted.htm", indoor_page())
        self.season.page("d1indoor26", "men_accepted.htm", indoor_page("Men"))

    def test_matches_a_saved_season_to_the_archive_from_the_cache(self):
        self.season.page("d1indoor26", "women_review.htm", indoor_page(), links="Coaches review")
        saved, totals, report = self.season.run()
        self.assertEqual((saved["season"], saved["year"], saved["cancelled"]), ("indoor", "2025-2026", False))
        self.assertEqual(saved["lists"], [{"region": "National", "list_id": "5352", "depth": 50}])
        self.assertEqual([(s["gender"], s["region"], s["generated"], s["fetched"]) for s in saved["sources"]],
                         [("f", "National", "2026-03-03T16:18", "2026-10-24"), ("m", "National", "2026-03-03T16:18", "2026-10-24")])
        self.assertEqual(saved["sources"][0]["url"], "https://www.rtspt.com/ncaa/d1indoor26/women_accepted.htm")
        sprint = next(f for f in saved["fields"] if f["gender"] == "f" and f["event"] == "60 Meters")
        self.assertEqual(sprint["entries"], [
            {"name": "Mara Quill", "school": "Ole Miss", "seed": "7.08", "list_rank": 1, "match": "exact"},
            {"name": "Tess Varden", "school": "Tarleton Sta", "seed": "7.10", "list_rank": 3, "match": "exact"}])
        relay_field = next(f for f in saved["fields"] if f["gender"] == "f" and f["event"] == "4 x 400 Relay")
        self.assertEqual([(e["name"], e["list_rank"]) for e in relay_field["entries"]], [("Arkansas", 1), ("TX A&M", 3)])
        self.assertIn("f 60 Meters: 2 accepted (exact 2); line 16, field reached 3", report)
        self.assertNotIn("review", report)
        self.assertEqual((totals["entries"], totals["matched"], totals["unmatched"]), (8, 8, 0))

    def test_writes_a_file_that_reads_back(self):
        saved, _, _ = self.season.run()
        path = write_entries(saved, self.season.data)
        self.assertEqual(path, self.season.data / "archive" / "entries" / "indoor" / "2025-2026.json")
        self.assertEqual(load_entries(self.season.data), {("indoor", "2025-2026"): saved})
        self.assertEqual(path.read_text(), encode_entries(saved))

    def test_a_full_list_counts_only_declared_athletes(self):
        extra = [("Event 3  Women Indoor Pentathlon", False, [
            athlete(1, "Ruth Ambrose", "Illinois", "4459D"), athlete(2, "Sela Moana", "KS State", "4401S"),
            athlete(3, "Bo Vance", "Utah", "4300A")])]
        self.season.page("d1indoor26", "women_accepted.htm", indoor_page(extra=extra))
        self.season.archive({"60 Meters": SPRINT, "4 x 400 Relay": RELAY, "Pentathlon": rows(
            ("Ambrose, Ruth", "Illinois", "4459"), ("Moana, Sela", "Kansas State", "4401"))})
        self.season.page("d1indoor26", "men_accepted.htm", indoor_page("Men", extra=[
            ("Event 4  Men Heptathlon", False, [athlete(1, "Ruth Ambrose", "Illinois", "4459D")])]))
        self.season.archive({"60 Meters": SPRINT, "4 x 400 Relay": RELAY, "Pentathlon": rows(
            ("Ambrose, Ruth", "Illinois", "4459"), ("Moana, Sela", "Kansas State", "4401"))})
        with self.assertRaises(ValueError):
            # The men's page has a heptathlon the saved list doesn't.
            self.season.run()
        self.season.page("d1indoor26", "men_accepted.htm", indoor_page("Men", extra=[
            ("Event 4  Men Indoor Pentathlon", False, [athlete(1, "Ruth Ambrose", "Illinois", "4459D")])]))
        saved, _, _ = self.season.run()
        pent = next(f for f in saved["fields"] if f["gender"] == "f" and f["event"] == "Pentathlon")
        self.assertEqual([e["name"] for e in pent["entries"]], ["Ruth Ambrose"])

    def test_reports_unmatched_entries_and_main_writes_only_when_allowed(self):
        self.season.page("d1indoor26", "women_accepted.htm", hytek(
            ["NCAA Division I 2026 Indoor Championship"], [
                ("Event 1  Women 60 Meter Dash Prelims", False, [
                    athlete(1, "Mara Quill", "Ole Miss", "7.08D"), athlete(2, "Zia Unknown", "Nowhere", "7.09D")]),
                ("Event 2  Women 4x400 Meter Relay", True, [relay(1, "Arkansas", "3:25.82D")])]))
        saved, totals, report = self.season.run()
        self.assertIn("UNMATCHED Zia Unknown (Nowhere) 7.09  near: 2:Hale, Ada/Baylor/7.09", report)
        self.assertIn("f 60 Meters: 2 accepted (exact 1); 1 UNMATCHED", report)
        self.assertEqual(totals["unmatched"], 1)
        argv = ["indoor", "2025-2026", "--entries-cache", str(self.season.pages), "--list-cache", str(self.season.lists),
                "--data-dir", str(self.season.data), "--aliases", str(self.season.aliases)]
        target = self.season.data / "archive" / "entries" / "indoor" / "2025-2026.json"
        with patch.object(import_entries, "load_config", return_value=INDOOR_CONFIG), redirect_stdout(io.StringIO()):
            self.assertEqual(import_entries.main(argv), 1)
            self.assertFalse(target.exists())
            self.assertEqual(import_entries.main(argv + ["--allow-unmatched"]), 0)
        self.assertTrue(target.exists())

    def test_refuses_what_it_cannot_trust(self):
        with self.assertRaisesRegex(ValueError, "not final yet"):
            self.season.run(today="2026-03-20")
        self.season.page("d1indoor26", "men_accepted.htm", indoor_page("Men", year=2025))
        with self.assertRaisesRegex(ValueError, "not the 2025-2026 indoor championship"):
            self.season.run()
        self.season.page("d1indoor26", "men_accepted.htm", indoor_page("Women"))
        with self.assertRaisesRegex(ValueError, "Two accepted lists"):
            self.season.run()
        self.season.page("d1indoor26", "men_accepted.htm", "<html><body><p>Gone</p></body></html>")
        with self.assertRaises(ValueError):
            self.season.run()
        (self.season.pages / "d1indoor26" / "men_accepted.htm").unlink()
        (self.season.pages / "d1indoor26" / "men_accepted.htm.meta.json").write_text(json.dumps({"status": 404}))
        with self.assertRaisesRegex(ValueError, "No accepted list for National m"):
            self.season.run()

    def test_a_changed_cached_page_is_refused(self):
        path = self.season.pages / "d1indoor26" / "men_accepted.htm"
        path.write_bytes(path.read_bytes().replace(b"Mara Quill", b"Mara Quilt"))
        with self.assertRaisesRegex(ValueError, "checksum"):
            self.season.run()


class ListCacheSeasonTests(unittest.TestCase):
    """Seasons before the archive's are matched to lists cached at limit 100, and keep their rows."""

    def setUp(self):
        self.season = Season(self)
        title = ["NCAA Division I 2019 Outdoor"]
        for cfg in (EAST, WEST):
            region = cfg["region"]
            self.season.page("d1outdoor19", f"{region.lower()}_men_declared.htm", hytek(
                [*title, f"Track & Field Championships -{region} Preliminary"],
                [("Event 1  Men 100 Meter Dash Prelims", False, [
                    athlete(1, f"Ike {region}", "TX A&M", "10.01"), athlete(2, f"Jo {region}", "Baylor", "10.30")]),
                 ("Event 2  Men Hammer Throw", False, [athlete(1, f"Lu {region}", "Ole Miss", "70.00m")])],
                stamp="HY-TEK's Meet Manager"))
            self.season.page("d1outdoor19", f"{region.lower()}_women_declared.htm", hytek(
                [*title, f"Track & Field Championships -{region} Preliminary"],
                [("Event 3  Women 4x100 Meter Relay", True, [relay(1, "Arkansas", "42.10")])],
                stamp="HY-TEK's Meet Manager 5/20/2019 07:23 PM"))
            for gender, events in (("m", {
                    "100 Meters": [(f"{region}, Ike", "Texas A&M", "10.01"), ("Ford, Al", "LSU", "10.10"),
                                   ("Gray, Bo", "Rice", "10.20")],
                    "Hammer": [(f"{region}, Lu", "Ole Miss", "70.00m")],
                    "Decathlon": [("Hart, Cy", "Iowa", "7800")]}),
                    ("f", {"4 x 100 Relay": [("Arkansas (C)", "Arkansas (C)", "42.10")]})):
                path = self.season.lists / f"{cfg['list_id']}-{gender}-100.html"
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(tfrrs(cfg, gender, events))
        self.season.page("d1outdoor19", "dec_declared.htm", hytek(
            ["NCAA Division I 2019 Outdoor Track & Field Championships", "Austin, TX"],
            [("Event 4  Men Decathlon", False, [athlete(1, "Cy Hart", "Iowa", "7800")])]), links="Decathlon")

    def test_stores_rows_flags_beyond_and_leaves_out_the_multis(self):
        saved, totals, report = self.season.run("outdoor", "2019", OUTDOOR_CONFIG)
        self.assertEqual(saved["lists"], [{"region": "East", "list_id": "2569", "depth": 100},
                                          {"region": "West", "list_id": "2570", "depth": 100}])
        self.assertEqual({(s["region"], s["gender"], s["generated"]) for s in saved["sources"]},
                         {("East", "m", None), ("West", "m", None), ("East", "f", "2019-05-20T19:23"),
                          ("West", "f", "2019-05-20T19:23")})
        sprint = next(f for f in saved["fields"] if f["region"] == "East" and f["event"] == "100 Meters")
        first, second = sprint["entries"]
        self.assertEqual(first, {"name": "Ike East", "school": "TX A&M", "seed": "10.01", "list_rank": 1,
                                 "match": "exact", "row": {"athlete": "East, Ike", "team": "Texas A&M", "time": "10.01"}})
        self.assertEqual(second, {"name": "Jo East", "school": "Baylor", "seed": "10.30", "list_rank": None,
                                  "match": "none", "beyond": True})
        relay_field = next(f for f in saved["fields"] if f["region"] == "West" and f["event"] == "4 x 100 Relay")
        self.assertEqual(relay_field["entries"][0]["list_rank"], 1)
        self.assertNotIn("Decathlon", {f["event"] for f in saved["fields"]})
        self.assertIn("m 100 Meters: 2 accepted (exact 1); past the 3 saved rows", report)
        self.assertEqual((totals["unmatched"], totals["beyond"], totals["beyond_events"]), (0, 2, 2))

    def test_a_missing_cached_list_stops_the_season(self):
        (self.season.lists / "2570-f-100.html").unlink()
        with self.assertRaisesRegex(ValueError, "No cached 100-deep list for outdoor 2019 West f"):
            self.season.run("outdoor", "2019", OUTDOOR_CONFIG)


class SeasonTests(unittest.TestCase):
    def test_season_labels_and_ranges(self):
        self.assertEqual(season_year("indoor", "2015"), "2014-2015")
        self.assertEqual(season_year("indoor", "2014_2015"), "2014-2015")
        self.assertEqual(season_year("outdoor", 2026), "2026")
        self.assertEqual(seasons("outdoor", OUTDOOR_CONFIG, 2015), ["2019"])
        self.assertEqual(seasons("indoor", OUTDOOR_CONFIG, 2015), ["2019-2020", "2025-2026"])
        self.assertEqual(seasons("indoor", OUTDOOR_CONFIG, 2015, 2020), ["2019-2020"])

    def test_no_meet_and_a_cancelled_meet(self):
        season = Season(self)
        with self.assertRaisesRegex(ValueError, "no outdoor 2020 championship"):
            season.run("outdoor", "2020", OUTDOOR_CONFIG)
        season.page("d1indoor20", "women_selected.htm", indoor_page(year=2020).replace(
            "HY-TEK's Meet Manager 3/3/2026 04:18 PM", "HY-TEK's Meet Manager"), links="Female")
        season.page("d1indoor20", "men_selected.htm", indoor_page("Men", year=2020), links="Male")
        for gender in ("m", "f"):
            (season.lists / f"2770-{gender}-100.html").parent.mkdir(parents=True, exist_ok=True)
            (season.lists / f"2770-{gender}-100.html").write_text(tfrrs(COVID, gender, {
                "60 Meters": [("Quill, Mara", "Ole Miss", "7.08"), ("Varden, Tess", "Tarleton State", "7.10")],
                "4 x 400 Relay": [("Arkansas", "Arkansas", "3:25.82"), ("Texas A&M", "Texas A&M", "3:27.01")]}))
        saved, totals, report = season.run("indoor", "2019-2020", OUTDOOR_CONFIG)
        self.assertTrue(saved["cancelled"])
        self.assertIn("== indoor 2019-2020 (meet cancelled)", report)
        self.assertEqual(totals["available"], 4)
        self.assertEqual([s["generated"] for s in saved["sources"]], [None, "2026-03-03T16:18"])


def entries_file(**changes):
    saved = {"season": "indoor", "year": "2025-2026", "cancelled": False,
             "sources": [{"kind": "accepted", "gender": "f", "region": "National",
                          "url": "https://www.rtspt.com/ncaa/d1indoor26/women_accepted.htm",
                          "generated": "2026-03-03T16:18", "fetched": "2026-10-24", "sha256": "a" * 64}],
             "lists": [{"region": "National", "list_id": "5352", "depth": 50}],
             "fields": [{"gender": "f", "region": "National", "event": "60 Meters", "entries": [
                 {"name": "Mara Quill", "school": "Ole Miss", "seed": "7.08", "list_rank": 1, "match": "exact"},
                 {"name": "Zia Ray", "school": "Rice", "seed": "7.30", "list_rank": None, "match": "none",
                  "beyond": True}]}]}
    saved.update(changes)
    return saved


class EntriesFileTests(unittest.TestCase):
    def test_valid_file_and_every_malformed_part(self):
        self.assertEqual(validate_entries(entries_file()), entries_file())
        self.assertEqual(json.loads(encode_entries(entries_file())), entries_file())
        broken = []
        for change in [dict(season="cross"), dict(year="2026"), dict(cancelled=None), dict(sources=[]), dict(lists=[]),
                       dict(fields=[])]:
            broken.append(entries_file(**change))
        source = entries_file()
        source["sources"][0]["sha256"] = "x"
        broken.append(source)
        source = entries_file()
        source["sources"][0]["generated"] = "Mar 3"
        broken.append(source)
        source = entries_file()
        source["sources"].append(dict(source["sources"][0]))
        broken.append(source)
        for key, value in [("list_rank", 0), ("list_rank", None), ("match", "guess"), ("name", ""),
                           ("beyond", True), ("row", {"athlete": "Quill, Mara"})]:
            entry = entries_file()
            entry["fields"][0]["entries"][0][key] = value
            broken.append(entry)
        twice = entries_file()
        twice["fields"][0]["entries"][1].update(list_rank=1, match="mark")
        del twice["fields"][0]["entries"][1]["beyond"]
        broken.append(twice)
        orphan = entries_file()
        orphan["fields"][0]["gender"] = "m"
        broken.append(orphan)
        repeated = entries_file()
        repeated["fields"].append(copy.deepcopy(repeated["fields"][0]))
        broken.append(repeated)
        for saved in broken:
            with self.subTest(saved=saved), self.assertRaises(ValueError):
                validate_entries(saved)

    def test_a_file_must_sit_at_its_season(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "archive" / "entries" / "indoor" / "2024-2025.json"
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps(entries_file()))
            with self.assertRaisesRegex(ValueError, "holds indoor 2025-2026"):
                load_entries(tmp)


def line_rows(count, team="School"):
    return [dict(rank=r, athlete=f"Runner, {r}", team=f"{team} {r}", time=f"{10 + r / 100:.2f}", place=r,
                 conversion=None) for r in range(1, count + 1)]


def matched(*ranks, rows=None):
    return [dict(name=f"{r} Runner", school=f"School {r}", seed="10.00", list_rank=r, match="exact",
                 **({"row": rows[r - 1]} if rows else {})) for r in ranks]


def outdoor(event="100 Meters", rankings=None, year="2026"):
    return dict(event=event, season="outdoor", region="East", year=year, rankings=rankings)


class InterpretFieldTests(unittest.TestCase):
    def test_a_field_held_at_the_line(self):
        record = dict(event="Mile", season="indoor", region="National", year="2025-2026", rankings=line_rows(30))
        field = interpret_field(record, matched(*range(1, 17)), "2026-03-03T16:18")
        self.assertEqual(field, {"status": "available", "rank": 16, "size": 16, "accepted": "2026-03-03",
                                 "cancelled": False,
                                 "entry": {"rank": 16, "athlete": "Runner, 16", "team": "School 16", "time": "10.16"},
                                 "unmatched": 0, "in": [], "out": [], "qualified": []})

    def test_a_field_that_fell_past_the_line(self):
        rankings = line_rows(60)
        ranks = [r for r in range(1, 52) if r not in (6, 12, 30)]
        field = interpret_field(outdoor(rankings=rankings), matched(*ranks), "2026-05-20T19:20")
        self.assertEqual((field["status"], field["rank"], field["size"]), ("available", 51, 48))
        self.assertEqual(field["in"], [49, 50, 51])
        self.assertEqual(field["out"], [6, 12, 30])
        self.assertEqual(field["entry"], {"rank": 51, "athlete": "Runner, 51", "team": "School 51", "time": "10.51"})

    def test_places_past_the_line_that_the_field_passed_over_are_out(self):
        record = dict(event="5000 Meters", season="indoor", region="National", year="2025-2026", rankings=line_rows(30))
        # 16th and 18th scratched: the field took 17th and 19th, so 18th is out though it sits past the line.
        field = interpret_field(record, matched(*range(1, 16), 17, 19))
        self.assertEqual((field["rank"], field["in"], field["out"]), (19, [17, 19], [16, 18]))
        # Nothing past the deepest place taken is out.
        self.assertNotIn(20, field["out"])

    def test_unmatched_and_beyond_the_list(self):
        rankings = line_rows(50)
        entries = matched(*range(1, 48)) + [dict(name="A B", school="C", seed="9.00", list_rank=None, match="none")]
        field = interpret_field(outdoor(rankings=rankings), entries, None)
        self.assertEqual(field, {"status": "unmatched", "rank": None, "size": 48, "accepted": None, "cancelled": False,
                                 "entry": None, "unmatched": 1, "in": [], "out": [], "qualified": []})
        entries[-1]["beyond"] = True
        self.assertEqual(interpret_field(outdoor(rankings=rankings), entries)["status"], "beyond_list")
        # A matched rank the saved list no longer reaches is past it too.
        field = interpret_field(outdoor(rankings=line_rows(40)), matched(*range(1, 49)))
        self.assertEqual((field["status"], field["rank"], field["unmatched"]), ("beyond_list", None, 0))
        # Unmatched outweighs beyond.
        entries.append(dict(name="D E", school="F", seed="9.10", list_rank=None, match="none"))
        self.assertEqual(interpret_field(outdoor(rankings=rankings), entries)["status"], "unmatched")

    def test_a_cancelled_meet_and_relays(self):
        record = dict(event="4 x 400 Relay", season="indoor", region="National", year="2019-2020",
                      rankings=line_rows(20))
        field = interpret_field(record, matched(*range(1, 12), 14), None, cancelled=True)
        self.assertEqual((field["rank"], field["in"], field["out"], field["cancelled"]), (14, [14], [12, 13], True))
        field = interpret_field(dict(record, event="4 x 100 Relay", season="outdoor", region="West", year="2019",
                                     rankings=line_rows(30)),
                                matched(*range(1, 25)))
        self.assertEqual((field["rank"], field["in"], field["out"]), (24, [], []))

    def test_a_relay_squad_lettered_b_or_later_is_already_qualified_not_out(self):
        rankings = line_rows(20)
        rankings[2].update(athlete="School 1 (B)", team="School 1 (B)")
        rankings[4].update(athlete="School 5 (C)", team="School 5 (C)")
        rankings[6].update(athlete="School 30 (B)", team="School 30 (B)")
        record = dict(event="4 x 400 Relay", season="indoor", region="National", year="2025-2026", rankings=rankings)
        # 1st and 5th are in; 3rd and 5th's squads are their schools' second teams. 7th is a squad whose school
        # isn't in the field: not a scratch either. 9th really scratched.
        taken = [r for r in range(1, 16) if r not in (3, 7, 9)]
        field = interpret_field(record, matched(*taken))
        self.assertEqual((field["out"], field["qualified"]), ([9], [3]))
        rankings[4].update(athlete="School 6 (C)", team="School 6 (C)")
        field = interpret_field(record, matched(*[r for r in range(1, 16) if r not in (3, 5, 7, 9)], 16))
        self.assertEqual((field["out"], field["qualified"]), ([9], [3, 5]))
        # Outside relays a "(B)" is just part of a name.
        field = interpret_field(dict(record, event="Mile"), matched(*taken))
        self.assertEqual((field["out"], field["qualified"]), ([3, 7, 9, 16], []))

    def test_ties_use_list_positions_and_one_athlete_listed_twice_is_not_out(self):
        rankings = line_rows(20)
        rankings[15].update(time=rankings[14]["time"], place=15)
        rankings[3] = dict(rankings[2], rank=4)
        record = dict(event="60 Meters", season="indoor", region="National", year="2025-2026", rankings=rankings)
        field = interpret_field(record, matched(1, 2, 3, *range(5, 15), 16, 17, 18))
        self.assertEqual((field["rank"], field["in"], field["out"]), (18, [17, 18], [15]))
        self.assertEqual(field["entry"]["rank"], 18)

    def test_history_lines_take_rows_from_the_entries_and_leave_out_in_and_out(self):
        rows = [dict(athlete=f"Runner, {r}", team=f"School {r}", time="10.00", flag="@", conversion="altitude",
                     converted="Converted from 9.98 for Altitude") for r in range(1, 20)]
        field = interpret_field(outdoor(year="2016"), matched(*range(1, 18), 19, rows=rows), "2016-05-20", history=True)
        self.assertEqual(field, {"status": "available", "rank": 19, "size": 18, "accepted": "2016-05-20",
                                 "cancelled": False, "unmatched": 0,
                                 "entry": {"rank": 19, "athlete": "Runner, 19", "team": "School 19", "time": "10.00",
                                           "flag": "@", "conversion": "altitude",
                                           "converted": "Converted from 9.98 for Altitude"}})
        with self.assertRaisesRegex(ValueError, "No saved row"):
            interpret_field(outdoor(year="2016"), matched(1, 2), history=True)


class DeriveTests(unittest.TestCase):
    def setUp(self):
        self.record = dict(year="2025-2026", season="indoor", region="National", gender="f", event="60 Meters",
                           rankings=line_rows(30))
        self.other = dict(self.record, event="200 Meters")
        self.config = {"active": [INDOOR]}
        self.past = {"lines": [
            dict(season="indoor", region="National", gender="f", event="60 Meters", year="2025-2026", rank=16, place=16,
                 mark="10.16", athlete="Runner, 16", team="School 16", rule="line", comparable=True),
            dict(season="indoor", region="National", gender="f", event="60 Meters", year="2015-2016", rank=16, place=16,
                 mark="7.30", athlete="Old, Runner", team="Old School", rule="line", comparable=True),
            dict(season="indoor", region="National", gender="f", event="60 Meters", year="2014-2015", rank=16, place=16,
                 mark="7.31", athlete="Older, Runner", team="Old School", rule="line", comparable=True)]}
        rows = [dict(athlete=f"Old, {r}", team="Old School", time=f"7.{r:02d}") for r in range(1, 20)]
        self.entries = {
            ("indoor", "2025-2026"): entries_file(fields=[{"gender": "f", "region": "National", "event": "60 Meters",
                                                           "entries": matched(*range(1, 16), 18)}]),
            ("indoor", "2015-2016"): entries_file(year="2015-2016", cancelled=False, sources=[
                dict(entries_file()["sources"][0], generated=None)], fields=[
                {"gender": "f", "region": "National", "event": "60 Meters", "entries": matched(*range(1, 17), rows=rows)}])}

    def derive(self, entries):
        return derive_files([self.record, self.other], {}, self.config, {}, self.past, entries)

    def test_list_and_history_files_carry_the_field(self):
        files = self.derive(self.entries)
        other, sprint = files["site/indoor-2025-2026-f-National.json"]["events"]
        self.assertEqual(list(sprint)[:3], ["event", "qualification", "field"])
        self.assertEqual(sprint["field"], {"status": "available", "rank": 18, "size": 16, "accepted": "2026-03-03",
                                           "cancelled": False, "unmatched": 0, "in": [18], "out": [16, 17], "qualified": [],
                                           "entry": {"rank": 18, "athlete": "Runner, 18", "team": "School 18",
                                                     "time": "10.18"}})
        self.assertNotIn("field", other)
        lines = files["site/history-indoor-f.json"]["lines"]
        current, old, older = lines
        self.assertEqual(current["field"]["rank"], 18)
        self.assertNotIn("in", current["field"])
        self.assertEqual(old["field"], {"status": "available", "rank": 16, "size": 16, "accepted": None,
                                        "cancelled": False, "unmatched": 0,
                                        "entry": {"rank": 16, "athlete": "Old, 16", "team": "Old School", "time": "7.16"}})
        self.assertNotIn("field", older)

    def test_seasons_without_imports_are_unchanged(self):
        plain = self.derive(None)
        self.assertEqual(self.derive({}), plain)
        files = self.derive({key: value for key, value in self.entries.items() if key[1] == "2015-2016"})
        self.assertEqual(files["site/indoor-2025-2026-f-National.json"], plain["site/indoor-2025-2026-f-National.json"])
        self.assertEqual({k: v for k, v in files.items() if k != "site/history-indoor-f.json"},
                         {k: v for k, v in plain.items() if k != "site/history-indoor-f.json"})

    def test_validation_reads_the_entries_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp)
            archive = data / "archive" / "indoor"
            archive.mkdir(parents=True)
            lists = [dict(date=None, region="National", gender="f", event=r["event"], rankings=r["rankings"])
                     for r in (self.record, self.other)]
            (archive / "2025-2026.json").write_text(json.dumps({"season": "indoor", "year": "2025-2026", "checked": [],
                                                                "lists": lists}))
            (data / "archive" / "past_cutoffs.json").write_text(json.dumps(self.past))
            for saved in self.entries.values():
                write_entries(saved, data)
            from tfrrs_data import publish
            publish([self.record, self.other], {}, self.config, data, championships={})
            with redirect_stdout(io.StringIO()):
                validate_data(data, self.config, {})
            field = json.loads((data / "site" / "indoor-2025-2026-f-National.json").read_text())["events"]
            self.assertTrue(any("field" in event for event in field))
            path = data / "archive" / "entries" / "indoor" / "2025-2026.json"
            saved = json.loads(path.read_text())
            saved["fields"][0]["entries"][0]["list_rank"] = 20
            path.write_text(json.dumps(saved))
            with self.assertRaisesRegex(ValueError, "Stale published data"):
                validate_data(data, self.config, {})
            saved["fields"][0]["entries"][0]["match"] = "maybe"
            path.write_text(json.dumps(saved))
            with self.assertRaisesRegex(ValueError, "Invalid entry"):
                validate_data(data, self.config, {})


if __name__ == "__main__":
    unittest.main()
