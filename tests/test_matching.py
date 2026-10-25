import json
from pathlib import Path
import shutil
import tempfile
import unittest

from matching import beyond_depth, load_aliases, match_entries, report, tfrrs_name

FIXTURES = Path(__file__).resolve().parent / 'fixtures' / 'hytek'
ALIASES = {"schools": {"FL State": "Florida State", "TX A&M": "Texas A&M", "IA State": "Iowa State"},
           "athletes": []}


def entry(name, school, seed, rank=1):
    return dict(rank=rank, name=name, school=school, seed=seed, status=None, **{"class": "SR"})


def row(rank, athlete, team, time, **extra):
    return {"rank": rank, "athlete": athlete, "team": team, "time": time, "place": rank, "conversion": None, **extra}


def matched(results):
    return [(r["list_rank"], r["match"]) for r in results]


class NameTests(unittest.TestCase):
    def test_tfrrs_names(self):
        for name, expected in [("Adaejah Hodge", "Hodge, Adaejah"), ("Alida Van Daalen", "Van Daalen, Alida"),
                               ("Jip de Greef", "de Greef, Jip"), ("Janet Jepkemboi Amimo", "Amimo, Janet Jepkemboi"),
                               ("Mia Brahe-Pedersen", "Brahe-Pedersen, Mia"), ("John Smith Jr.", "Smith Jr., John"),
                               ("Madonna", "Madonna")]:
            self.assertEqual(tfrrs_name(name), expected)


class MatchTests(unittest.TestCase):
    def test_seed_name_and_school_is_exact_even_with_shared_surnames_and_marks(self):
        rankings = [row(6, "Joseph, Rachel", "Iowa State", "51.36"), row(7, "Joseph, Esther", "Tennessee", "51.36")]
        entries = [entry("Esther Joseph", "Tennessee", "51.36"), entry("Rachel Joseph", "IA State", "51.36")]
        self.assertEqual(matched(match_entries(entries, rankings, ALIASES)), [(7, "exact"), (6, "exact")])

    def test_converted_and_field_marks(self):
        rankings = [row(2, "Mayberry, Indya", "TCU", "22.57", flag="@", conversion="altitude",
                        converted="Converted from 22.50 for Altitude"),
                    row(1, "Adeshina, Temitope", "Texas Tech", "1.97m")]
        for seed in ("22.57", "22.50"):
            results = match_entries([entry("Indya Mayberry", "TCU", seed)], rankings, ALIASES)
            self.assertEqual(matched(results), [(2, "exact")])
        results = match_entries([entry("Temitope Adeshina", "TX Tech", "1.97")], rankings, ALIASES)
        self.assertEqual(matched(results), [(1, "mark")])
        self.assertEqual(results[0]["row"]["athlete"], "Adeshina, Temitope")

    def test_schools_by_alias_and_truncated_column(self):
        rankings = [row(1, "Walker, Shenese", "Florida State", "7.09"), row(2, "Brandt, Nell", "West Virginia", "1.91m")]
        entries = [entry("Shenese Walker", "FL State", "7.09"), entry("Nell Brandt", "West Virgini", "1.91")]
        self.assertEqual(matched(match_entries(entries, rankings, ALIASES)), [(1, "exact"), (2, "exact")])

    def test_accents_hyphens_and_spelling(self):
        rankings = [row(1, "Närhi, Tuomas", "Miss State", "74.30m"), row(2, "Sy-Savane, Abdoul", "Arkansas", "7.55"),
                    row(3, "StPeters, Lauren", "Nebraska", "15.41m"), row(4, "Crooke, Kya", "Arizona", "1.85m"),
                    row(5, "Törnström, Victor", "Ohio State", "7.72")]
        entries = [entry("Tuomas Nã¤rhi", "Miss State", "74.30"), entry("Abdoul Sysavane", "Arkansas", "7.55"),
                   entry("Lauren St. Peters", "Nebraska", "15.41"), entry("Kya Crook", "Arizona", "1.85"),
                   entry("Victor Toernstroem", "Ohio State", "7.72")]
        self.assertEqual(matched(match_entries(entries, rankings, ALIASES)),
                         [(1, "exact"), (2, "exact"), (3, "exact"), (4, "mark"), (5, "exact")])

    def test_names_cut_by_the_column(self):
        rankings = [row(40, "Cattermole-Williams, Charlotte", "Kansas State", "58.99m")]
        results = match_entries([entry("Charlotte Cattermole-William", "KS State", "58.99")], rankings,
                                {"schools": {"KS State": "Kansas State"}, "athletes": []})
        self.assertEqual(matched(results), [(40, "exact")])

    def test_name_and_school_when_the_list_mark_changed(self):
        rankings = [row(12, "Okafor, Gia", "Texas Tech", "1.95m")]
        results = match_entries([entry("Gia Okafor", "TX Tech", "1.97")], rankings,
                                {"schools": {"TX Tech": "Texas Tech"}, "athletes": []})
        self.assertEqual(matched(results), [(12, "name")])

    def test_never_guesses(self):
        # Two Jacksons at one school: a different first name is not the same athlete.
        rankings = [row(37, "Jackson, Anya", "Arkansas", "11.36")]
        self.assertEqual(matched(match_entries([entry("Shawnti Jackson", "Arkansas", "11.45")], rankings, ALIASES)),
                         [(None, "none")])
        # Two possible rows: no match.
        rankings = [row(3, "Smith, Jordan", "Baylor", "10.10"), row(4, "Smith, Josh", "Baylor", "10.12")]
        self.assertEqual(matched(match_entries([entry("Jo Smith", "Baylor", "10.30")], rankings, ALIASES)),
                         [(None, "none")])
        # Two entries wanting the one row: neither gets it.
        rankings = [row(5, "Lee, Kim", "Rice", "52.00")]
        entries = [entry("Kim Lee", "Rice", "52.10"), entry("Kim Lee", "Rice", "52.20", rank=2)]
        self.assertEqual(matched(match_entries(entries, rankings, ALIASES)), [(None, "none"), (None, "none")])
        # A surname alone is never enough.
        self.assertEqual(matched(match_entries([entry("Kim Lee", "Duke", "53.00")], rankings, ALIASES)),
                         [(None, "none")])

    def test_one_athlete_listed_twice_takes_the_higher_row(self):
        rankings = [row(24, "Devaney, Rory", "Cal Poly", "57.63m"), row(25, "Devaney, Rory", "Cal Poly", "57.63m"),
                    row(26, "Devaney, Sam", "Cal Poly", "57.50m")]
        entries = [entry("Rory Devaney", "Cal Poly", "57.63"), entry("Sam Devaney", "Cal Poly", "57.50", rank=2)]
        self.assertEqual(matched(match_entries(entries, rankings, ALIASES)), [(24, "exact"), (26, "exact")])

    def test_manual_overrides_apply_within_their_scope(self):
        rankings = [row(1, "Hollis, Ada", "Georgia", "10.77"), row(18, "Quinn, Ruth", "Baylor", "10.99")]
        aliases = {"schools": {}, "athletes": [
            {"season": "outdoor", "year": "2026", "gender": "f", "event": "100 Meters", "name": "Ruthie Quinn-Ames",
             "list_rank": 18}]}
        scope = dict(season="outdoor", year="2026", gender="f", event="100 Meters")
        entries = [entry("Ruthie Quinn-Ames", "Baylor", "11.02")]
        self.assertEqual(matched(match_entries(entries, rankings, aliases, scope=scope)), [(18, "manual")])
        self.assertEqual(matched(match_entries(entries, rankings, aliases, scope=dict(scope, event="200 Meters"))),
                         [(None, "none")])
        self.assertEqual(matched(match_entries(entries, rankings, aliases)), [(None, "none")])
        aliases["athletes"][0]["list_rank"] = 40
        with self.assertRaises(ValueError):
            match_entries(entries, rankings, aliases, scope=scope)

    def test_relays_match_on_school(self):
        rankings = [row(5, "Texas A&M", "Texas A&M", "3:02.71"), row(30, "Texas A&M (B)", "Texas A&M (B)", "3:05.55"),
                    row(7, "Florida State", "Florida State", "3:03.10")]
        entries = [entry("TX A&M", "TX A&M", "3:02.71"), entry("FL State", "FL State", "3:03.50", rank=2),
                   entry("Rice", "Rice", "3:09.00", rank=3)]
        self.assertEqual(matched(match_entries(entries, rankings, ALIASES, relay=True)),
                         [(5, "exact"), (7, "name"), (None, "none")])

    def test_beyond_saved_depth(self):
        rankings = [row(1, "A, B", "X", "10.10"), row(50, "C, D", "Y", "10.40")]
        self.assertTrue(beyond_depth(entry("E F", "Z", "10.41"), rankings, "100 Meters"))
        self.assertFalse(beyond_depth(entry("E F", "Z", "10.30"), rankings, "100 Meters"))
        field = [row(1, "A, B", "X", "8.10m"), row(50, "C, D", "Y", "7.40m")]
        self.assertTrue(beyond_depth(entry("E F", "Z", "7.38"), field, "Long Jump"))
        self.assertFalse(beyond_depth(entry("E F", "Z", "7.90"), field, "Long Jump"))


class ReportTests(unittest.TestCase):
    def test_reports_each_event_against_the_final_list(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            cache = tmp / "cache" / "d1indoor26"
            cache.mkdir(parents=True)
            shutil.copy(FIXTURES / "indoor_accepted_2026.htm", cache / "women_accepted.htm")
            shutil.copy(FIXTURES / "indoor_review_2026.htm", cache / "women_review.htm")
            sprint = [row(1, "Varden, Tess", "Tarleton State", "7.08"), row(2, "Quill, Mara", "Ole Miss", "7.08"),
                      row(3, "Joseph, Odile", "Tennessee", "7.12"), row(4, "Joseph, Ines", "Iowa State", "7.12")]
            jump = [row(1, "Okafor, Gia", "Texas Tech", "1.97m"), row(2, "Lane, Bo", "Utah", "1.95m")]
            lists = [dict(date=None, region="National", gender="f", event=name, rankings=rows)
                     for name, rows in [("60 Meters", sprint), ("High Jump", jump)]]
            archive = tmp / "data" / "archive" / "indoor"
            archive.mkdir(parents=True)
            (archive / "2025-2026.json").write_text(json.dumps(
                {"season": "indoor", "year": "2025-2026", "checked": [], "lists": lists}))
            aliases = tmp / "aliases.json"
            aliases.write_text(json.dumps(ALIASES))
            lines = []
            totals = report("indoor", "2025-2026", tmp / "cache", tmp / "data", aliases, out=lines.append)
        text = "\n".join(lines)
        self.assertIn("f 60 Meters: 4 accepted, deepest rank 4, exact 4", text)
        self.assertIn("f High Jump: 2 accepted, deepest rank 1, mark 1, 1 beyond saved depth (2 rows)", text)
        self.assertIn("f Mile: no saved list", text)
        self.assertNotIn("women_review", text)
        self.assertEqual(totals, dict(entries=12, matched=5, unmatched=6, beyond=1))

    def test_committed_aliases_are_valid(self):
        aliases = load_aliases()
        self.assertTrue(aliases["schools"])
        for key, value in aliases["schools"].items():
            self.assertTrue(key.strip() and value.strip() and key != value)
        for item in aliases["athletes"]:
            self.assertTrue({"season", "year", "gender", "event", "name", "list_rank"} <= set(item))


if __name__ == "__main__":
    unittest.main()
