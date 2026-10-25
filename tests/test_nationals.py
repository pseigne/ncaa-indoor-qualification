import copy
import json
from pathlib import Path
import tempfile
import unittest

from nationals import derive_nationals, load_nationals, nationals_index, validate_nationals
from tfrrs_data import derive_files

SOURCES = [
    {"kind": "index", "region": "National", "label": "Qualifier lists (RecordTiming)",
     "url": "https://www.rtspt.com/ncaa/d1outdoor26/"},
    {"kind": "qualifiers", "gender": "f", "region": "National", "label": "Qualifier list (RecordTiming)",
     "url": "https://www.rtspt.com/ncaa/d1outdoor26/women_qualifiers.htm", "sha256": "a" * 64},
    {"kind": "results", "region": "East", "label": "East First Round (Flash Results)",
     "url": "https://www.flashresults.com/2026/East/index.htm"},
    {"kind": "results", "region": "National", "label": "Nationals (Flash Results)",
     "url": "https://www.flashresults.com/2026/NCAA/index.htm"},
]


def result(round="final", place=None, mark=None, status=None, wind=None, points=None):
    return {"round": round, "place": place, "mark": mark, "wind": wind, "status": status, "points": points}


def qualifier(name, seed, nationals=None, region="East", list_rank=1, first_round=None, team="School"):
    return {"name": name, "team": team, "school": team, "seed": seed, "region": region, "list_rank": list_rank,
            "tfrrs_id": None, "first_round": first_round, "nationals": nationals}


def season(events=None, year="2026"):
    fr = {"place": 1, "mark": "10.91", "wind": "+1.2", "q": "Q"}
    events = events if events is not None else [
        {"gender": "f", "event": "100 Meters", "qualifiers": [
            qualifier("Dns, Ann", "11.00", result("semifinal", status="DNS")),
            qualifier("Semi, Slow", "11.30", result("semifinal", mark="11.40"), list_rank=7),
            qualifier("Prelim, Out", "11.10", result("prelim", mark="11.50")),
            qualifier("Second, Bea", "11.20", result(place=2, mark="10.90", wind="+0.4", points=8), region="West"),
            qualifier("Semi, Fast", "11.05", result("semifinal", mark="11.20"), list_rank=3, first_round=fr),
            qualifier("Dnf, Final", "11.01", result(status="DNF")),
            qualifier("First, Cy", "11.25", result(place=1, mark="10.84", wind="+0.4", points=10)),
            qualifier("None, Yet", "10.99", None),
        ]},
        {"gender": "f", "event": "Long Jump", "qualifiers": [
            qualifier("Short, Al", "6.40", None), qualifier("Long, Bo", "6.80", None),
            qualifier("Mid, Cy", "6.60", None)]},
        {"gender": "m", "event": "Decathlon", "qualifiers": [
            qualifier("Ten, Tom", "8100", result(place=1, mark="8200"), region="National", list_rank=None)]},
    ]
    return {"season": "outdoor", "year": year, "meet": {"name": "NCAA Outdoor Championships", "start_date": f"{year}-06-10"},
            "sources": copy.deepcopy(SOURCES), "events": events}


def record(region="East", gender="f", event="100 Meters", ranks=range(1, 9), year="2026"):
    return dict(year=year, season="outdoor", region=region, gender=gender, event=event,
                rankings=[dict(rank=rank, athlete=f"Runner {rank}", team="School", time="11.00") for rank in ranks])


class DeriveTests(unittest.TestCase):
    def test_one_file_per_season_and_gender_in_the_site_contract(self):
        files = derive_nationals({"2026": season()}, [])
        self.assertEqual(sorted(files), ["site/nationals-outdoor-2026-f.json", "site/nationals-outdoor-2026-m.json"])
        women = files["site/nationals-outdoor-2026-f.json"]
        self.assertEqual({k: women[k] for k in ("season", "year", "gender", "meet")},
                         {"season": "outdoor", "year": "2026", "gender": "f",
                          "meet": {"name": "NCAA Outdoor Championships", "start_date": "2026-06-10"}})
        # Only the season's index and its Flash meets are shown; the pages read stay in the archive.
        self.assertEqual(women["sources"], [{"label": s["label"], "url": s["url"]} for s in SOURCES if s["kind"] != "qualifiers"])
        self.assertEqual([e["event"] for e in women["events"]], ["100 Meters", "Long Jump"])
        first = women["events"][0]["qualifiers"][2]
        self.assertEqual(first, {"athlete": "Semi, Fast", "team": "School", "region": "East", "listRank": 3, "seed": "11.05",
                                 "firstRound": {"place": 1, "mark": "10.91", "wind": "+1.2", "q": "Q"},
                                 "nationals": {"place": None, "round": "semifinal", "mark": "11.20", "wind": None,
                                               "status": None, "points": None}})
        men = files["site/nationals-outdoor-2026-m.json"]
        self.assertEqual(men["events"][0]["qualifiers"][0]["region"], "National")

    def test_qualifiers_go_by_place_then_round_reached_then_seed_with_statuses_last(self):
        events = derive_nationals({"2026": season()}, [])["site/nationals-outdoor-2026-f.json"]["events"]
        self.assertEqual([q["athlete"] for q in events[0]["qualifiers"]], [
            "First, Cy", "Second, Bea", "Semi, Fast", "Semi, Slow", "Prelim, Out", "Dnf, Final", "Dns, Ann", "None, Yet"])
        # Before results a field event is in seed order, the longest first.
        self.assertEqual([q["athlete"] for q in events[1]["qualifiers"]], ["Long, Bo", "Mid, Cy", "Short, Al"])

    def test_list_ranks_must_be_on_the_saved_final_list(self):
        derive_nationals({"2026": season()}, [record(), record("West")])
        with self.assertRaisesRegex(ValueError, "Semi, Slow has list rank 7"):
            derive_nationals({"2026": season()}, [record(ranks=range(1, 7))])
        # A season the archive has no lists for is not checked; saved days are not final lists.
        derive_nationals({"2026": season()}, [record(year="2025"), record(year="2026 (2026-05-01)", ranks=[1])])

    def test_index_entries_and_derive_files(self):
        files = derive_nationals({"2026": season(), "2019": season(year="2019")}, [])
        self.assertEqual(nationals_index(files), [
            {"season": "outdoor", "year": "2026", "gender": "m", "file": "nationals-outdoor-2026-m.json"},
            {"season": "outdoor", "year": "2026", "gender": "f", "file": "nationals-outdoor-2026-f.json"},
            {"season": "outdoor", "year": "2019", "gender": "m", "file": "nationals-outdoor-2019-m.json"},
            {"season": "outdoor", "year": "2019", "gender": "f", "file": "nationals-outdoor-2019-f.json"}])
        config = {"active": [dict(year="2026", season="outdoor", region="East", list_id="1", list_name="List")]}
        plain = derive_files([record()], {}, config, {})
        self.assertEqual(plain["site/index.json"]["nationals"], [])
        self.assertFalse(any(name.startswith("site/nationals-") for name in plain))
        full = derive_files([record()], {}, config, {}, nationals={"2026": season()})
        self.assertEqual(full["site/nationals-outdoor-2026-f.json"],
                         derive_nationals({"2026": season()}, [record()])["site/nationals-outdoor-2026-f.json"])
        self.assertEqual([e["file"] for e in full["site/index.json"]["nationals"]],
                         ["nationals-outdoor-2026-m.json", "nationals-outdoor-2026-f.json"])
        self.assertEqual({k: v for k, v in full.items() if not k.startswith("site/nationals-") and k != "site/index.json"},
                         {k: v for k, v in plain.items() if k != "site/index.json"})


class ValidateTests(unittest.TestCase):
    def test_valid_file_and_every_malformed_part(self):
        validate_nationals(season())
        broken = {
            "season": lambda s: s.update(season="indoor"),
            "year": lambda s: s.update(year="26"),
            "meet": lambda s: s["meet"].update(start_date="June"),
            "no sources": lambda s: s.update(sources=[]),
            "source kind": lambda s: s["sources"][0].update(kind="other"),
            "source link": lambda s: s["sources"][0].update(url="javascript:alert(1)"),
            "page gender": lambda s: s["sources"][1].pop("gender"),
            "checksum": lambda s: s["sources"][1].update(sha256="x"),
            "event name": lambda s: s["events"][0].update(event="Mile"),
            "duplicate event": lambda s: s["events"].append(copy.deepcopy(s["events"][0])),
            "no qualifiers": lambda s: s["events"][0].update(qualifiers=[]),
            "name": lambda s: s["events"][0]["qualifiers"][0].update(name=""),
            "region": lambda s: s["events"][0]["qualifiers"][0].update(region="North"),
            "national region on a First Round event": lambda s: s["events"][0]["qualifiers"][0].update(region="National"),
            "regional multi": lambda s: s["events"][2]["qualifiers"][0].update(region="East"),
            "rank": lambda s: s["events"][0]["qualifiers"][0].update(list_rank=0),
            "first round keys": lambda s: s["events"][0]["qualifiers"][0].update(first_round={"place": 1}),
            "q": lambda s: s["events"][0]["qualifiers"][4]["first_round"].update(q="X"),
            "round": lambda s: s["events"][0]["qualifiers"][0]["nationals"].update(round="heat"),
            "place out of the final": lambda s: s["events"][0]["qualifiers"][1]["nationals"].update(place=9),
            "status": lambda s: s["events"][0]["qualifiers"][0]["nationals"].update(status="SCR"),
            "points": lambda s: s["events"][0]["qualifiers"][3]["nationals"].update(points=-1),
        }
        for label, change in broken.items():
            saved = season()
            change(saved)
            with self.subTest(label), self.assertRaises(ValueError):
                validate_nationals(saved)

    def test_files_load_from_their_own_place(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "archive" / "nationals" / "outdoor"
            folder.mkdir(parents=True)
            (folder / "2026.json").write_text(json.dumps(season()))
            self.assertEqual(load_nationals(tmp), {"2026": season()})
            (folder / "2025.json").write_text(json.dumps(season()))
            with self.assertRaisesRegex(ValueError, "holds outdoor 2026"):
                load_nationals(tmp)
        self.assertEqual(load_nationals("/nonexistent"), {})


if __name__ == "__main__":
    unittest.main()
