import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
from urllib.parse import parse_qs, urlparse

from list_cache import cache_path, choose, prefetch
from tfrrs_data import load_config
from test_data import html, response, session_for

INDOOR = dict(year="2014-2015", season="indoor", region="National", list_id="1345", list_name="list")
EAST = dict(year="2015", season="outdoor", region="East", list_id="1440", list_name="list")


class ListCacheTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.cache = Path(self.tmp.name) / "list-cache"

    def test_fetches_each_page_once_at_the_limit_with_its_meta(self):
        waits = []
        session = session_for([INDOOR, EAST], count=110)
        results = prefetch([INDOOR, EAST], 100, session=session, sleeper=waits.append, cache_dir=self.cache)
        self.assertEqual([r["status"] for r in results], ["fetched"] * 4)
        self.assertEqual(waits, [3, 3, 3])
        self.assertEqual({parse_qs(urlparse(c.args[0]).query)["limit"][0] for c in session.get.call_args_list}, {"100"})
        self.assertEqual(results[0]["events"], {"400 Meters": 110})
        path = cache_path("1345", "f", 100, self.cache)
        self.assertEqual(path.name, "1345-f-100.html")
        meta = json.loads(path.with_suffix(".meta.json").read_text())
        self.assertEqual(meta["url"], "https://tf.tfrrs.org/lists/1345/list?gender=f&limit=100")
        self.assertEqual((meta["status"], meta["sha256"]), (200, hashlib.sha256(path.read_bytes()).hexdigest()))
        self.assertIn("fetched", meta)
        # A second run reads the cache and asks for nothing.
        session = Mock()
        results = prefetch([INDOOR, EAST], 100, session=session, sleeper=waits.append, cache_dir=self.cache)
        self.assertEqual([r["status"] for r in results], ["cached"] * 4)
        session.get.assert_not_called()

    def test_a_page_that_fails_its_checks_is_reported_and_not_saved(self):
        session = Mock()
        session.get.side_effect = [response(html(cfg=INDOOR, limit=50)), response(html(cfg=INDOOR, gender="f", limit=100)),
                                   response(html(cfg=EAST, limit=100).replace("East", "West")),
                                   response(html(cfg=EAST, gender="f", limit=100))]
        results = prefetch([INDOOR, EAST], 100, session=session, sleeper=lambda _: None, cache_dir=self.cache)
        self.assertEqual([r["status"] for r in results], ["failed", "fetched", "failed", "fetched"])
        self.assertIn("depth", results[0]["error"])
        self.assertIn("identity", results[2]["error"])
        self.assertEqual(sorted(p.name for p in self.cache.iterdir()),
                         ["1345-f-100.html", "1345-f-100.meta.json", "1440-f-100.html", "1440-f-100.meta.json"])

    def test_a_host_that_keeps_refusing_stops_the_run_and_keeps_what_was_fetched(self):
        waits = []
        session = Mock()
        session.get.side_effect = [response(html(cfg=INDOOR, limit=100))] + [response(status=429)] * 3
        results = prefetch([INDOOR, EAST], 100, session=session, sleeper=waits.append, cache_dir=self.cache)
        self.assertEqual([r["status"] for r in results], ["fetched", "failed", "skipped", "skipped"])
        self.assertEqual(waits, [3, 60, 120])
        self.assertEqual(session.get.call_count, 4)
        self.assertTrue(cache_path("1345", "m", 100, self.cache).exists())

    def test_only_tfrrs_limits_are_asked_for(self):
        with self.assertRaises(ValueError):
            prefetch([INDOOR], 99, session=Mock(), cache_dir=self.cache)

    def test_choose_uses_championship_years(self):
        archive = load_config()["archive"]
        chosen = choose(archive, 2015, 2023, regions={"National", "East", "West"})
        indoor = [c["year"] for c in chosen if c["season"] == "indoor"]
        self.assertEqual(indoor[0], "2014-2015")
        self.assertEqual(indoor[-1], "2022-2023")
        self.assertEqual(len(indoor), 9)
        regional = choose(archive, 2015, 2023, season="outdoor", regions={"East", "West"})
        self.assertEqual(len(regional), 18)
        self.assertIn("cancelled", {c.get("status") for c in regional})


if __name__ == "__main__":
    unittest.main()
