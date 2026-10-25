import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
from urllib.parse import parse_qs, urlparse

import requests

from tfrrs_data import (ROOT, collect, list_url, load_archive, load_config, parse_page, publish,
                        run_scrape, validate_config)
from tfrrs_lists import Blocked, fetch_page, verify_page_identity
from test_data import html, record, response, session_for

EAST = dict(year="2025", season="outdoor", region="East", list_id="5052", list_name="East_List", depth=100)
WEST = dict(EAST, region="West", list_id="5053", list_name="West_List")
INDOOR = dict(year="2025-2026", season="indoor", region="National", list_id="5352", list_name="Indoor_List")
CONFIG = {"active": [dict(EAST, year="2026", list_id="5622"), INDOOR],
          "historical": [dict(EAST, year="2026", list_id="5622"), INDOOR, EAST, WEST,
                         dict(INDOOR, year="2024-2025", list_id="4867")]}


def outdoor(year="2025", region="East", gender="m", count=50):
    return dict(record(year, gender=gender, count=count), season="outdoor", region=region)


def requested(session):
    return [(urlparse(c.args[0]).path, parse_qs(urlparse(c.args[0]).query)) for c in session.get.call_args_list]


def historical_scraper():
    spec = importlib.util.spec_from_file_location("historical_scraper", ROOT / "historical-scraper.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DepthTests(unittest.TestCase):
    def test_a_deep_list_asks_for_its_limit_and_keeps_tied_rows_past_it(self):
        session = session_for([EAST], count=130)
        rows = collect([EAST], session=session, sleeper=lambda _: None)
        self.assertEqual([query["limit"] for _, query in requested(session)], [["100"], ["100"]])
        self.assertEqual({len(r["rankings"]) for r in rows}, {120})
        # A list without a depth keeps TFRRS's default page and the 60-row cap.
        session = session_for([INDOOR], count=130)
        rows = collect([INDOOR], session=session, sleeper=lambda _: None)
        self.assertEqual([("limit" in query) for _, query in requested(session)], [False, False])
        self.assertEqual({len(r["rankings"]) for r in rows}, {60})
        self.assertEqual(list_url(INDOOR, "f"), "https://tf.tfrrs.org/lists/5352/Indoor_List?gender=f")
        self.assertEqual(list_url(INDOOR, "f", 100), "https://tf.tfrrs.org/lists/5352/Indoor_List?gender=f&limit=100")
        self.assertEqual(len(parse_page(html(count=130, cfg=EAST), EAST, "m", cap=30)[0]["rankings"]), 30)

    def test_collection_waits_three_seconds_between_pages(self):
        waits = []
        collect([EAST], session=session_for([EAST]), sleeper=waits.append)
        self.assertEqual(waits, [3, 3])

    def test_a_page_that_ignores_the_requested_depth_fails(self):
        verify_page_identity(html(cfg=EAST, limit=100), EAST, "m")
        for body in [html(cfg=EAST), html(cfg=EAST, limit=50)]:
            with self.assertRaisesRegex(ValueError, "depth"):
                verify_page_identity(body, EAST, "m")
            session = Mock()
            session.get.return_value = response(body)
            with self.assertRaisesRegex(ValueError, "depth"):
                collect([EAST], session=session, sleeper=lambda _: None)
        # A list without a depth doesn't look at the limit.
        verify_page_identity(html(cfg=INDOOR, limit=50), INDOOR, "m")

    def test_depth_must_be_one_of_the_tfrrs_limits(self):
        for depth in (100, 5, 500):
            validate_config({"active": [dict(EAST, depth=depth)], "historical": [EAST]})
        for depth in (99, "100", True, 0, None, 1000):
            with self.subTest(depth=depth), self.assertRaisesRegex(ValueError, "depth"):
                validate_config({"active": [dict(EAST, depth=depth)], "historical": [EAST]})

    def test_real_configuration_deepens_only_outdoor_regional_lists(self):
        config = load_config()
        for group in ("active", "historical"):
            for cfg in config[group]:
                regional = cfg["season"] == "outdoor" and cfg["region"] != "National"
                self.assertEqual(cfg.get("depth"), 100 if regional else None, cfg)
        self.assertFalse(any("depth" in cfg for cfg in config["archive"]))

    def test_403_and_429_back_off_then_stop(self):
        waits = []
        session = Mock()
        session.get.side_effect = [response(status=429), response(status=403), response("ok")]
        self.assertEqual(fetch_page(session, "https://tf.tfrrs.org/lists/1/x", waits.append), "ok")
        self.assertEqual(waits, [60, 120])
        waits.clear()
        session.get.side_effect = [response(status=429)] * 3
        with self.assertRaises(Blocked):
            fetch_page(session, "https://tf.tfrrs.org/lists/1/x", waits.append)
        self.assertEqual(waits, [60, 120])
        self.assertTrue(issubclass(Blocked, requests.RequestException))


class FilteredHistoricalTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name) / "data"
        self.seed = [record(), record("2025-2026 (2026-01-10)"), record("2024-2025"),
                     outdoor("2026"), outdoor(), outdoor(gender="f"), outdoor(region="West"),
                     dict(outdoor("2025 (2025-05-01)"), rankings=outdoor()["rankings"][:30])]
        self.checked = {("indoor", "2025-2026"): ["2026-01-10"], ("outdoor", "2025"): ["2025-05-01"]}
        publish(self.seed, self.checked, CONFIG, self.data, championships={})

    def scrape(self, session, filters):
        return run_scrape("historical", data_dir=self.data, config=CONFIG, session=session,
                          sleeper=lambda _: None, championships={}, filters=filters)

    def test_recollecting_replaces_only_the_matching_final_lists(self):
        session = session_for(CONFIG["historical"], performance="44.00", count=105)
        self.scrape(session, {"season": "outdoor", "years": {"2025"}, "regions": {"East", "West"}})
        self.assertEqual(sorted(path for path, _ in requested(session)),
                         ["/lists/5052/East_List"] * 2 + ["/lists/5053/West_List"] * 2)
        records, checked = load_archive(self.data)
        self.assertEqual(checked, self.checked)
        finals = {(r["year"], r["season"], r["region"], r["gender"]): r["rankings"] for r in records}
        for gender in ("m", "f"):
            for region in ("East", "West"):
                rankings = finals[("2025", "outdoor", region, gender)]
                self.assertEqual((len(rankings), rankings[0]["time"]), (105, "44.00"))
        # The saved day, the other seasons and indoor are left as they were.
        self.assertEqual(len(finals[("2025 (2025-05-01)", "outdoor", "East", "m")]), 30)
        self.assertEqual(len(finals[("2026", "outdoor", "East", "m")]), 50)
        self.assertEqual(finals[("2025-2026", "indoor", "National", "m")], record()["rankings"])
        self.assertEqual(len(records), len(self.seed) + 1)

    def test_years_are_championship_years_and_unmatched_filters_fetch_nothing(self):
        session = session_for(CONFIG["historical"])
        self.scrape(session, {"season": "indoor", "years": {"2025"}})
        self.assertEqual({path for path, _ in requested(session)}, {"/lists/4867/Indoor_List"})
        session = Mock()
        with self.assertRaisesRegex(ValueError, "No historical lists match"):
            self.scrape(session, {"season": "outdoor", "years": {"2019"}})
        session.get.assert_not_called()

    def test_command_line_filters(self):
        parse = historical_scraper().parse_filters
        self.assertEqual(parse(["--season", "outdoor", "--years", "2024,2025,2026", "--regions", "East,west"]),
                         {"season": "outdoor", "years": {"2024", "2025", "2026"}, "regions": {"East", "West"}})
        self.assertEqual(parse([]), {})
        with self.assertRaises(SystemExit):
            parse(["--regions", "North"])


if __name__ == "__main__":
    unittest.main()
