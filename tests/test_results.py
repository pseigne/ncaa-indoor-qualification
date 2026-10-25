import hashlib
import io
import json
from contextlib import redirect_stdout
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import import_results
from import_results import import_season, join_event, write_nationals
from nationals import load_nationals, validate_nationals
from test_entries import athlete, hytek
from validate_data import validate_data

ALIASES = {"schools": {"FL State": "Florida State", "So Alabama": "South Alabama"}, "athletes": []}


def entry(rank, name, school, seed):
    return {"rank": rank, "name": name, "class": "SR", "school": school, "seed": seed, "status": None}


def accepted(name, school, seed, list_rank, row=None):
    item = {"name": name, "school": school, "seed": seed, "list_rank": list_rank,
            "match": "exact" if list_rank else "none"}
    if row:
        item["row"] = row
    return item


def fr(place, name, school, mark, q="Q", tfrrs_id=None, wind="+1.0"):
    return {"place": place, "name": name, "school": school, "class": None, "mark": mark, "wind": wind, "q": q,
            "status": None, "tfrrs_id": tfrrs_id, "heat": None, "heat_place": None, "points": None}


def nat(name, school, place=None, mark=None, round="final", status=None, tfrrs_id=None, wind="+0.4", points=None):
    return {"name": name, "school": school, "tfrrs_id": tfrrs_id, "round": round, "place": place, "mark": mark,
            "wind": wind, "status": status, "points": points, "url": "https://example.com/round.htm"}


def flash(east=(), west=(), nationals=()):
    """One event as flash_results.season_results gives it."""
    def block(rows):
        return {"rows": list(rows), "advanced": sum(1 for row in rows if row["q"])}
    return {"first_round": {"East": block(east), "West": block(west)}, "nationals": list(nationals)}


def join(qualifiers, fields, flash_event, finals=None, event="100 Meters", gender="f", aliases=ALIASES):
    issues = []
    out, how = join_event("2026", gender, event, qualifiers, fields, finals or {}, flash_event, aliases, issues)
    return out, how, issues


class JoinTests(unittest.TestCase):
    def test_joins_nationals_by_the_tfrrs_id_flash_gives_both_meets(self):
        qualifiers = [entry(1, "Bree Selden", "USC", "10.83")]
        fields = {"West": [accepted("Bree Selden", "USC", "10.74", 2, {"athlete": "Selden, Bree", "team": "USC", "time": "10.74"})]}
        # The nationals page spells her name and school differently: only the id ties the two.
        out, how, issues = join(qualifiers, fields, flash(
            west=[fr(1, "Bree Selden", "USC", "10.83", tfrrs_id="8977035")],
            nationals=[nat("Breanna Selden", "Southern California", 1, "10.84", tfrrs_id="8977035")]))
        self.assertEqual(how, {0: "id"})
        self.assertEqual(out, [{
            "name": "Selden, Bree", "team": "USC", "school": "USC", "seed": "10.83", "region": "West", "list_rank": 2,
            "tfrrs_id": "8977035", "first_round": {"place": 1, "mark": "10.83", "wind": "+1.0", "q": "Q"},
            "nationals": {"round": "final", "place": 1, "mark": "10.84", "wind": "+0.4", "status": None, "points": None}}])
        self.assertEqual(issues, [])

    def test_joins_by_name_and_school_through_the_aliases(self):
        qualifiers = [entry(1, "Shea Walker", "FL State", "10.88"), entry(2, "Emma Berge", "So Alabama", "10.95")]
        fields = {"East": [accepted("Shea Walker", "FL State", "10.80", 2,
                                    {"athlete": "Walker, Shea", "team": "Florida State", "time": "10.80"}),
                           accepted("Emma Berge", "So Alabama", "10.99", 7,
                                    {"athlete": "Berge, Emma", "team": "South Alabama", "time": "10.99"})]}
        out, how, issues = join(qualifiers, fields, flash(
            east=[fr(2, "Shea Walker", "FL State", "10.88"), fr(5, "Emma Berge", "South Alabama", "10.95", q="q")],
            # No ids, and Flash writes the schools in full this time; the surname and school settle "Emmy".
            nationals=[nat("Shea Walker", "Florida State", 1, "10.84"),
                       nat("Emmy Berge", "South Alabama", None, "11.30", round="semifinal")]))
        self.assertEqual(how, {0: "name", 1: "name"})
        self.assertEqual([(q["name"], q["team"], q["region"], q["list_rank"]) for q in out],
                         [("Walker, Shea", "Florida State", "East", 2), ("Berge, Emma", "South Alabama", "East", 7)])
        self.assertEqual(out[1]["first_round"]["q"], "q")
        self.assertEqual((out[1]["nationals"]["round"], out[1]["nationals"]["place"]), ("semifinal", None))
        self.assertEqual(issues, [])

    def test_region_comes_from_the_accepted_list_and_is_checked_against_the_first_rounds(self):
        qualifiers = [entry(1, "Ann East", "Georgia", "11.00"), entry(2, "Bea West", "Texas", "11.01"),
                      entry(3, "Cat Cross", "LSU", "11.02"), entry(4, "Dee Gone", "Baylor", "11.03")]
        fields = {"East": [accepted("Ann East", "Georgia", "11.00", 1), accepted("Cat Cross", "LSU", "11.10", 4)],
                  "West": [accepted("Bea West", "Texas", "11.01", 3)]}
        out, _, issues = join(qualifiers, fields, flash(
            east=[fr(1, "Ann East", "Georgia", "11.00")],
            # Cat Cross is on the East list but in the West results; Dee Gone is on no list at all.
            west=[fr(1, "Bea West", "Texas", "11.01"), fr(2, "Cat Cross", "LSU", "11.02"), fr(3, "Dee Gone", "Baylor", "11.03")]))
        self.assertEqual([(q["region"], q["list_rank"]) for q in out],
                         [("East", 1), ("West", 3), (None, None), ("West", None)])
        self.assertIsNone(out[2]["first_round"])
        self.assertIn("2026 f 100 Meters: Cat Cross (LSU): accepted list says East, First Round results say West; "
                      "region left empty", issues)
        self.assertIn("2026 f 100 Meters: Dee Gone (Baylor) is on no First Round accepted list", issues)
        self.assertIn("2026 f 100 Meters: Dee Gone (Baylor): region West from the First Round results only", issues)

    def test_the_same_school_wins_over_a_name_cut_short(self):
        # "South Carolina" begins "South Carolina St.", as a cut column would; the exact school is the one.
        qualifiers = [entry(1, "South Carolina", "South Carolina", "43.36")]
        fields = {"East": [accepted("South Carolina St.", "South Carolina St.", "43.90", 30),
                           accepted("South Carolina", "South Carolina", "43.36", 11)]}
        out, _, issues = join(qualifiers, fields, flash(east=[fr(3, "South Carolina", "South Carolina", "43.36")]),
                              event="4 x 100 Relay")
        self.assertEqual((out[0]["region"], out[0]["list_rank"], out[0]["name"]), ("East", 11, "South Carolina"))
        self.assertIsNone(out[0]["tfrrs_id"])
        self.assertNotIn("accepted lists", " ".join(issues))

    def test_statuses_and_rounds_come_from_the_last_round_reached(self):
        qualifiers = [entry(1, "Ann Ash", "Oregon", "6.70"), entry(2, "Bo Birch", "Florida", "6.60")]
        fields = {"West": [accepted("Ann Ash", "Oregon", "6.70", 1)], "East": [accepted("Bo Birch", "Florida", "6.60", 2)]}
        out, _, _ = join(qualifiers, fields, flash(
            west=[fr(1, "Ann Ash", "Oregon", "6.70", tfrrs_id="1")], east=[fr(1, "Bo Birch", "Florida", "6.60", tfrrs_id="2")],
            nationals=[nat("Ann Ash", "Oregon", None, None, status="NM", tfrrs_id="1", wind=None),
                       nat("Bo Birch", "Florida", None, None, round="semifinal", status="DNF", tfrrs_id="2", wind=None)]),
            event="Long Jump")
        self.assertEqual([q["nationals"] for q in out], [
            {"round": "final", "place": None, "mark": None, "wind": None, "status": "NM", "points": None},
            {"round": "semifinal", "place": None, "mark": None, "wind": None, "status": "DNF", "points": None}])

    def test_multis_are_national_and_rank_on_the_national_list_with_replacements_added(self):
        qualifiers = [entry(1, "Sofi Cruz", "Washington", "6093"), entry(2, "Pia Gone", "Oklahoma", "5900")]
        national = [{"rank": 1, "athlete": "Cruz, Sofi", "team": "Washington", "time": "6093"},
                    {"rank": 2, "athlete": "Gone, Pia", "team": "Oklahoma", "time": "5900"},
                    {"rank": 3, "athlete": "Williams, Annika", "team": "Oregon", "time": "5880"}]
        event = flash(nationals=[nat("Sofi Cruz", "Washington", 1, "6182", wind=None),
                                 nat("Annika Williams", "Oregon", 8, "5832", tfrrs_id="77", wind=None)])
        out, _, issues = join(qualifiers, {}, event, {("National", "f", "Heptathlon"): national}, event="Heptathlon")
        self.assertEqual([(q["name"], q["region"], q["list_rank"], q["seed"], q["nationals"] and q["nationals"]["place"])
                          for q in out],
                         [("Cruz, Sofi", "National", 1, "6093", 1), ("Gone, Pia", "National", 2, "5900", None),
                          ("Williams, Annika", "National", 3, "5880", 8)])
        self.assertTrue(all(q["first_round"] is None for q in out))
        self.assertIn("2026 f Heptathlon: Pia Gone (Oklahoma) not found in the nationals results", issues)
        self.assertIn("2026 f Heptathlon: Annika Williams (Oregon) added from the nationals results, "
                      "not on the heptathlon list", issues)
        # Without the national list in the archive there is no rank, and that is not a failure to report.
        out, _, issues = join(qualifiers[:1], {}, flash(nationals=[nat("Sofi Cruz", "Washington", 1, "6182")]),
                              event="Heptathlon")
        self.assertEqual((out[0]["list_rank"], out[0]["name"], out[0]["team"]), (None, "Cruz, Sofi", "Washington"))
        self.assertEqual(issues, [])

    def test_twenty_five_qualifiers_are_all_kept(self):
        names = [f"Hurdler{n} Man" for n in range(25)]
        qualifiers = [entry(n + 1, name, "Arkansas", f"{49 + n / 100:.2f}") for n, name in enumerate(names)]
        fields = {"West": [accepted(name, "Arkansas", f"{49 + n / 100:.2f}", n + 1) for n, name in enumerate(names)]}
        rows = [fr(n + 1, name, "Arkansas", f"{49 + n / 100:.2f}", q=None if n == 24 else "Q", tfrrs_id=str(n))
                for n, name in enumerate(names)]
        entrants = [nat(name, "Arkansas", None, f"{50 + n / 100:.2f}", round="semifinal", tfrrs_id=str(n))
                    for n, name in enumerate(names)]
        out, how, issues = join(qualifiers, fields, flash(west=rows, nationals=entrants), event="400 Hurdles", gender="m")
        self.assertEqual(len(out), 25)
        self.assertEqual(set(how.values()), {"id"})
        self.assertEqual(issues, ["2026 m 400 Hurdles: Hurdler24 Man (Arkansas): in the West First Round results "
                                  "without a Q or q"])


SEASON_CONFIG = {"2026": {"east": "https://www.flashresults.com/2026/East/index.htm",
                          "west": "https://www.flashresults.com/2026/West/index.htm",
                          "nationals": "https://www.flashresults.com/2026/NCAA/index.htm",
                          "meet": {"name": "NCAA Outdoor Championships", "start_date": "2026-06-10"}}}
TITLE = ["NCAA Division I 2026 Outdoor", "Track & Field Championships", "Eugene, OR - 6/10/2026 to 6/13/2026"]
STAMP = "HY-TEK's Meet Manager 5/31/2026 09:16 AM"


def season_results(events):
    def fake(year, config, fetcher=None, **kwargs):
        return {"season": "outdoor", "year": year, "meet": config[year]["meet"], "events": events, "skipped": []}
    return fake


class ImportSeasonTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        self.data, self.pages, self.aliases = root / "data", root / "entries-cache", root / "aliases.json"
        self.aliases.write_text(json.dumps(ALIASES))
        lists = [dict(date=None, region=region, gender="f", event="100 Meters", rankings=[
            dict(rank=1, athlete="Selden, Bree", team="USC", time="10.74"),
            dict(rank=2, athlete="Walker, Shea", team="Florida State", time="10.80")]) for region in ("East", "West")]
        lists.append(dict(date=None, region="National", gender="m", event="Decathlon", rankings=[
            dict(rank=1, athlete="Ten, Tom", team="Kansas", time="8100")]))
        archive = self.data / "archive" / "outdoor"
        archive.mkdir(parents=True)
        (archive / "2026.json").write_text(json.dumps({"season": "outdoor", "year": "2026", "checked": [], "lists": lists}))
        source = {"kind": "accepted", "gender": "f", "url": "https://www.rtspt.com/ncaa/d1outdoor26/east.htm",
                  "generated": "2026-05-20T19:21", "fetched": "2026-10-24", "sha256": "0" * 64}
        entries = {"season": "outdoor", "year": "2026", "cancelled": False,
                   "sources": [dict(source, region="East"), dict(source, region="West")],
                   "lists": [{"region": "East", "list_id": "1", "depth": 100}, {"region": "West", "list_id": "2", "depth": 100}],
                   "fields": [{"gender": "f", "region": "East", "event": "100 Meters",
                               "entries": [accepted("Shea Walker", "FL State", "10.80", 2)]},
                              {"gender": "f", "region": "West", "event": "100 Meters",
                               "entries": [accepted("Bree Selden", "USC", "10.74", 1)]}]}
        folder = self.data / "archive" / "entries" / "outdoor"
        folder.mkdir(parents=True)
        (folder / "2026.json").write_text(json.dumps(entries))
        self.page("women_qualifiers.htm", hytek(TITLE, [("Event 21  Women 100 Meter Dash Prelims", False, [
            athlete(1, "Bree Selden", "USC", "10.83", "SO"), athlete(2, "Shea Walker", "FL State", "10.88")])], STAMP))
        self.page("men_qualifiers.htm", hytek(TITLE, [
            ("Event 1  Men 100 Meter Dash Prelims", False, [athlete(1, "Al Lone", "Iowa", "10.01")]),
            ("Event 41  Men Decathlon", False, [athlete(1, "Tom Ten", "Kansas", "8100")])], STAMP))
        self.events = [
            {"gender": "f", "event": "100 Meters", "relay": False, "multi": False, "nationals_rounds": [],
             **flash(east=[fr(2, "Shea Walker", "FL State", "10.88", tfrrs_id="5")],
                     west=[fr(1, "Bree Selden", "USC", "10.83", tfrrs_id="4")],
                     nationals=[nat("Shea Walker", "Florida State", 1, "10.88", tfrrs_id="5"),
                                nat("Bree Selden", "USC", 2, "10.90", tfrrs_id="4")])},
            {"gender": "m", "event": "Decathlon", "relay": False, "multi": True, "nationals_rounds": [],
             **flash(nationals=[nat("Tom Ten", "Kansas", 1, "8200", wind=None)])}]

    def page(self, name, html):
        folder = self.pages / "d1outdoor26"
        folder.mkdir(parents=True, exist_ok=True)
        body = html.encode("cp1252")
        (folder / name).write_bytes(body)
        (folder / f"{name}.meta.json").write_text(json.dumps(
            {"url": f"https://www.rtspt.com/ncaa/d1outdoor26/{name}", "fetched": "2026-10-24", "status": 200,
             "sha256": hashlib.sha256(body).hexdigest()}))

    def run_season(self):
        lines = []
        with patch.object(import_results.flash_results, "season_results", season_results(self.events)):
            saved, totals, issues = import_season("2026", self.pages, self.root_results(), self.data, self.aliases,
                                                  SEASON_CONFIG, offline=True, out=lines.append)
        return saved, totals, issues, lines

    def root_results(self):
        return self.data.parent / "results-cache"

    def test_imports_a_season_from_the_caches_and_publishes_it(self):
        saved, totals, issues, lines = self.run_season()
        self.assertEqual(saved["meet"], {"name": "NCAA Outdoor Championships", "start_date": "2026-06-10"})
        self.assertEqual([s["kind"] for s in saved["sources"]], ["index", "qualifiers", "qualifiers", "results", "results", "results"])
        self.assertEqual(saved["sources"][0]["url"], "https://www.rtspt.com/ncaa/d1outdoor26/")
        hundred = next(e for e in saved["events"] if e["event"] == "100 Meters")
        self.assertEqual([(q["name"], q["region"], q["list_rank"], q["nationals"]["place"]) for q in hundred["qualifiers"]],
                         [("Selden, Bree", "West", 1, 2), ("Walker, Shea", "East", 2, 1)])
        decathlon = next(e for e in saved["events"] if e["event"] == "Decathlon")
        self.assertEqual((decathlon["qualifiers"][0]["region"], decathlon["qualifiers"][0]["list_rank"]), ("National", 1))
        # The men's 100m has no accepted lists or results here: its one qualifier is left without either.
        lone = next(e for e in saved["events"] if e["event"] == "100 Meters" and e["gender"] == "m")["qualifiers"][0]
        self.assertEqual((lone["name"], lone["region"], lone["list_rank"], lone["nationals"]), ("Lone, Al", None, None, None))
        self.assertIn("2026 m 100 Meters: no accepted lists imported", issues)
        self.assertEqual((totals["region"], totals["nationals"], totals["ranked"], totals["rankable"]), (2, 3, 3, 4))
        self.assertIn("2026 f 100 Meters: 2 qualifiers", issues)
        self.assertTrue(lines[0].startswith("== outdoor 2026: 4 qualifiers; region 2/3 (66.7%)"), lines[0])

        path = write_nationals(saved, self.data)
        self.assertEqual(path, self.data / "archive" / "nationals" / "outdoor" / "2026.json")
        self.assertEqual(load_nationals(self.data), {"2026": saved})
        from tfrrs_data import load_archive, publish
        records, checked = load_archive(self.data)
        config = {"active": [dict(year="2026", season="outdoor", region=region, list_id=str(n), list_name="List")
                             for n, region in enumerate(("East", "West"), 1)]}
        with redirect_stdout(io.StringIO()):
            publish(records, checked, config, self.data, championships={})
            validate_data(self.data, config, {})
        index = json.loads((self.data / "site" / "index.json").read_text())
        self.assertEqual(index["nationals"], [
            {"season": "outdoor", "year": "2026", "gender": "m", "file": "nationals-outdoor-2026-m.json"},
            {"season": "outdoor", "year": "2026", "gender": "f", "file": "nationals-outdoor-2026-f.json"}])
        site = json.loads((self.data / "site" / "nationals-outdoor-2026-f.json").read_text())
        self.assertEqual([q["athlete"] for q in site["events"][0]["qualifiers"]], ["Walker, Shea", "Selden, Bree"])

    def test_refuses_a_season_without_its_imports(self):
        (self.data / "archive" / "entries" / "outdoor" / "2026.json").unlink()
        with self.assertRaisesRegex(import_results.NotImportable, "run import_entries.py first"):
            self.run_season()
        with self.assertRaisesRegex(import_results.NotImportable, "No Flash Results pages"):
            import_season("2017", self.pages, self.root_results(), self.data, self.aliases, SEASON_CONFIG, offline=True)

    def test_a_qualifier_list_for_another_meet_is_refused(self):
        self.page("men_qualifiers.htm", hytek([t.replace("2026", "2025") for t in TITLE], [
            ("Event 41  Men Decathlon", False, [athlete(1, "Tom Ten", "Kansas", "8100")])], STAMP))
        with self.assertRaisesRegex(import_results.NotImportable, "not the 2026 outdoor championship"):
            self.run_season()

    def test_the_written_file_validates_and_reads_back(self):
        saved, _, _, _ = self.run_season()
        validate_nationals(saved)
        text = import_results.encode_nationals(saved)
        self.assertEqual(json.loads(text), saved)
        lines = text.splitlines()
        self.assertEqual(sum('"school":' in line for line in lines), sum(len(e["qualifiers"]) for e in saved["events"]))
        self.assertTrue(all(line.count('"school":') <= 1 for line in lines))

    def test_main_reports_without_writing_on_a_dry_run(self):
        out = io.StringIO()
        with patch.object(import_results.flash_results, "season_results", season_results(self.events)), \
                patch.object(import_results.flash_results, "load_config", lambda path=None: SEASON_CONFIG), \
                redirect_stdout(out):
            code = import_results.main(["outdoor", "2026", "--offline", "--dry-run", "--entries-cache", str(self.pages),
                                        "--data-dir", str(self.data), "--aliases", str(self.aliases)])
        self.assertEqual(code, 0)
        self.assertIn("== outdoor 2026", out.getvalue())
        self.assertFalse((self.data / "archive" / "nationals").exists())
        with self.assertRaises(SystemExit), redirect_stdout(io.StringIO()), \
                patch("sys.stderr", io.StringIO()):
            import_results.main(["outdoor", "2017"])


if __name__ == "__main__":
    unittest.main()
