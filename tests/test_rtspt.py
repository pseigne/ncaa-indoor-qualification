import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

import rtspt

INDEX = """<html><body>
<a href="http://www.ncaa.com/results/index.htm">NCAA.com</a>
<a href="day1_women_res.htm">html</a><a href="day1_women_res.pdf">pdf</a>
<a href="women_start_d1.htm">Day1</a>
<a href="women_accepted.htm">Female athletes accepted</a>
<a href="selected_men.htm">Male</a><a href="selected_men.htm">athletes accepted</a>
<a href="women_review.htm">review of female athletes</a>
<a href="women_perf.htm">Women's Qualifier List</a>
<a href="dec.htm">Decathlon</a>
<a href="hep_start.htm">Heptathlon Start Lists</a>
<a href="w_w_declared.htm">West Women's First Round Declared Athletes</a>
<a href="west_women_entries.htm">West female athletes</a>
<a href="west_men.htm">review of West male athletes</a>
<a href="http://www.rtspt.com/ncaa/d1outdoor21">Click here for 2021 Outdoor</a>
<a href="dec_scores.pdf">Dec Score Sheet</a>
</body></html>"""
BASE = "https://www.rtspt.com/ncaa/d1indoor26/"


def response(status=200, body=b"<pre>page</pre>"):
    result = Mock(status_code=status, content=body)
    result.raise_for_status.side_effect = None if status < 400 else Exception(f"HTTP {status}")
    return result


def session_for(pages, refusals=None):
    """A session serving `pages` by URL, refusing some URLs a number of times first."""
    refusals = dict(refusals or {})
    session = Mock()

    def get(url, **kwargs):
        if refusals.get(url):
            refusals[url] -= 1
            return response(429)
        return response(200, pages[url]) if url in pages else response(404)

    session.get.side_effect = get
    return session


class RecordTimingTests(unittest.TestCase):
    def setUp(self):
        rtspt._last_request[0] = None
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.cache = Path(self.tmp.name)
        self.sleeps = []
        self.pages = {BASE: INDEX.encode(), BASE + "women_accepted.htm": b"<pre>women</pre>",
                      BASE + "selected_men.htm": b"<pre>men</pre>"}

    def fetch(self, session):
        return rtspt.fetch_season("indoor", "2025-2026", session=session, sleeper=self.sleeps.append,
                                  cache_dir=self.cache)

    def test_season_directories(self):
        self.assertEqual(rtspt.season_dir("indoor", "2025-2026"), "d1indoor26")
        self.assertEqual(rtspt.season_dir("indoor", "2014_2015"), "d1indoor15")
        self.assertEqual(rtspt.season_dir("outdoor", "2026"), "d1outdoor26")
        self.assertEqual(rtspt.season_dir("outdoor", 2015), "d1outdoor15")
        for season, year in [("indoor", "2025"), ("indoor", "2024-2026"), ("outdoor", "2025-2026"), ("cross", "2026")]:
            with self.subTest(year=year), self.assertRaises(ValueError):
                rtspt.season_dir(season, year)

    def test_links_are_chosen_by_text_and_filename_skipping_reviews_starts_and_results(self):
        names = [url.rsplit("/", 1)[1] for url in rtspt.entry_links(INDEX, BASE)]
        self.assertEqual(names, ["women_accepted.htm", "selected_men.htm", "women_perf.htm", "dec.htm",
                                 "w_w_declared.htm"])

    def test_caches_each_page_once_with_its_metadata(self):
        session = session_for(self.pages)
        paths = self.fetch(session)
        self.assertEqual([p.name for p in paths], ["women_accepted.htm", "selected_men.htm"])
        folder = self.cache / "d1indoor26"
        self.assertEqual((folder / "women_accepted.htm").read_bytes(), b"<pre>women</pre>")
        meta = json.loads((folder / "women_accepted.htm.meta.json").read_text())
        self.assertEqual(meta["url"], BASE + "women_accepted.htm")
        self.assertEqual(meta["status"], 200)
        self.assertEqual(meta["sha256"], hashlib.sha256(b"<pre>women</pre>").hexdigest())
        self.assertRegex(meta["fetched"], r"^\d{4}-\d{2}-\d{2}$")
        self.assertTrue((folder / rtspt.INDEX).exists())
        # Five links are wanted; three are missing from this fake site and are not cached.
        self.assertEqual(session.get.call_count, 6)
        for call in session.get.call_args_list:
            self.assertEqual(call.kwargs["timeout"], (10, 45))
            self.assertIn("ncaa-indoor-qualification", call.kwargs["headers"]["User-Agent"])
        # Requests are at least three seconds apart.
        self.assertEqual(len(self.sleeps), 5)
        self.assertTrue(all(0 < gap <= rtspt.PAUSE for gap in self.sleeps))
        again = session_for({})
        self.assertEqual(self.fetch(again), paths)
        again.get.assert_not_called()

    def test_a_missing_season_returns_nothing(self):
        session = session_for({})
        self.assertEqual(self.fetch(session), [])
        self.assertEqual(list(self.cache.rglob("*")), [])

    def test_waits_after_a_refusal_then_continues(self):
        session = session_for(self.pages, refusals={BASE + "women_accepted.htm": 1})
        paths = self.fetch(session)
        self.assertEqual(len(paths), 2)
        self.assertIn(60, self.sleeps)
        self.assertNotIn(120, self.sleeps)

    def test_stops_after_the_second_wait_and_keeps_what_it_has(self):
        session = session_for(self.pages, refusals={BASE + "selected_men.htm": 3})
        with self.assertRaises(rtspt.Refused):
            self.fetch(session)
        self.assertEqual([s for s in self.sleeps if s >= 60], [60, 120])
        folder = self.cache / "d1indoor26"
        self.assertTrue((folder / "women_accepted.htm").exists())
        self.assertFalse((folder / "selected_men.htm").exists())
        # A later run picks up where this one stopped.
        rerun = session_for(self.pages)
        self.assertEqual([p.name for p in self.fetch(rerun)], ["women_accepted.htm", "selected_men.htm"])
        self.assertEqual([c.args[0] for c in rerun.get.call_args_list][:1], [BASE + "selected_men.htm"])


if __name__ == "__main__":
    unittest.main()
