import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

from flash_results import (USER_AGENT, CacheOnly, Fetcher, HostBlocked, Robots, event_name, fetch_meet,
                           parse_dates, parse_index, parse_round, season_checks, season_results)

ROBOTS = "User-agent: *\nDisallow: /documents/\nDisallow: /*.pdf\n"


def index_page(title, dates, rows):
    body = "".join(
        f"<tr><td>Friday</td><td>5:00 PM</td><td class='e-status'></td>"
        f"<td class='fixed-column'><a href={href}>{label}</a></td><td>{rnd}</td>"
        f"<td><a href={href.replace('_compiled', '_start')}>Start List</a></td>"
        f"<td><a href={href}>Result</a></td></tr>" for label, rnd, href in rows)
    return (f"<html><head><title>{title}</title></head><body>"
            f"<p class='navbar-text text'>{title}<br><small>{dates}</small></p>"
            f"<table id='Sidebar'><thead><tr><th>Day</th><th>Start</th><th></th><th>Events</th>"
            f"<th>Rnd</th><th>Start List</th><th>Result</th></tr></thead><tbody>{body}</tbody></table>"
            "</body></html>")


def athlete(place, name, school, mark, q="", wind="+1.0", heat="1 (1)", tfrrs=None, cls="SR"):
    first, last = name.split(" ", 1)
    link = (f"<a href='#data' stats-href=\"https://www.tfrrs.org/athletes/{tfrrs}/{school}/{last}_{first}\""
            f"stats-name=\"{name}|{school}\" class='openStats'>{first} {last.upper()}</a>"
            if tfrrs else f"<a>{first} {last.upper()}</a>")
    q_cell = f"<span class = 'q_qual'> {q} </span>" if q else ""
    wind_cell = f"<font color=#007600>{wind}</font>" if wind else ""
    return (f"<tr><td>{place}</td><td><image src=logos/X.png></td><td><b>{link}</b><sup> 4</sup>"
            f"<br><small>{school} [{cls}]</small></td><td>{mark}  <br></td><td>{q_cell}</td>"
            f"<td>{wind_cell}</td><td><a href=x.htm>{heat} </a></td></tr>")


def relay(place, school, mark, q=""):
    q_cell = f"<span class = 'q_qual'> {q} </span>" if q else ""
    return (f"<tr><td>{place}</td><td><image src=logos/X.png></td><td><b> {school.upper()}</a></b>"
            f"<br><small>{school} </small></td><td>{mark}  <br></td><td>{q_cell}</td><td>"
            f"<td><a href=x.htm>1 (1) </a></td></tr>")


def round_page(label, rows, caption="", mark_header="Time", name_header="Athlete"):
    return ("<html><body><table class='table' id='headerevent'><thead>"
            "<tr><th>Event</th><th>Status</th></tr></thead>"
            f"<tr><td><a href = index.htm>{label.split(' (')[0]}</a> ({label.split(' (')[1]}</td><td></td></tr>"
            "<tr><td>Friday 5:00 PM</td><td>Total #:</td></tr></table>"
            "<table id='record'><thead><tr><th></th><th>Record</th></tr></thead>"
            "<tr><td>MR</td><td>Meet</td><td>Someone - School</td><td>9.99</td></tr></table>"
            f"<table id='events'><caption><i>Results: {label}<br>{caption}</caption></i>"
            f"<thead class='thead-dark'><tr><th>Pl</th><th></th><th>{name_header}</th>"
            f"<th>{mark_header}</th><th></th><th></th><th>Heat (pl)</th></tr></thead><tbody>"
            + "".join(rows) + "</tbody></table></body></html>")


OLD_ROUND = """<html><body><table id='headerevent'>
<tr><th width='350'>Event</th><th>Status</th></tr>
<tr><td><a href = https://www.tfrrs.org/lists/2568/?gender=m >Men 100 M</a> (Prelims)</td></tr>
</table><table id='events'>
<tr><th>Place</th><th></th><th>Athlete</th><th></th><th>Affiliation</th><th>Time</th><th></th><th></th><th>Heat (pl)</th></tr>
<tr class='normal'><td>1</td><td><image src=logos/TTU.png></td><td><a href = https://www.tfrrs.org/athletes/6166402/Texas_Tech/Oduduru_Divine>Divine ODUDURU</td><td>JR</td><td>Texas Tech</td><td>9.96 <small>(9.951)</small></td><td style = 'text-align:left'> Q </td><td><font color=red>+2.4</font></td><td>3 (1) </td></tr>
<tr class='alt'><td>2</td><td><image src=logos/X.png></td><td>Hakim SANI BROWN</td><td>SO</td><td>Florida</td><td>10.08</td><td> q </td><td><font color=red>-0.4</font></td><td>2 (1) </td></tr>
<tr class='normal'><td> </td><td><image src=logos/X.png></td><td>Trini FEGGETT</td><td>FR</td><td>Western Carolina</td><td>DNS </td><td></td><td></td><td>1</td></tr>
</table></body></html>"""

OLD_RELAY = """<table id='headerevent'><tr><th>Event</th></tr>
<tr><td>Men 4x100 M Relay (Quarterfinal)</td></tr></table><table id='events'>
<tr><th>Place</th><th></th><th>Team</th><th></th><th></th><th>Time</th><th></th><th></th><th>Heat (pl)</th></tr>
<tr><td>1</td><td></td><td>PURDUE</td><td></td><td>Purdue</td><td>38.75</td><td>Q</td><td>3 (1) SB</td><td>3 (1)</td></tr>
<tr><td></td><td></td><td>JACKSON STATE</td><td></td><td>Jackson State</td><td>DQ</td><td></td><td></td><td>1</td></tr>
</table>"""

SCORES = """<table id='headerevent'><tr><th>Event</th></tr><tr><td>Men Decathlon Scores View Graph</td></tr></table>
<table id='multitotalscores'><caption>Combined Event Total Scores: Decathlon</caption>
<tr><th>Pl</th><th></th><th>Athlete</th><th>Points</th><th>100m</th></tr>
<tr><td>1</td><td></td><td class='fixed-column'><b><a href='#data' stats-href="https://www.tfrrs.org/athletes/8238359/Miss_State/Bair_Peyton"stats-name="Peyton Bair|Miss State" class='openStats'>Peyton BAIR</b></a><br>Miss State [JR]<br><small>projected SB 8229 | diff 94</small></td>
<td class='best1'><center><b>8323<br>PB</b></center></td><td>10.25 (1) 1035 [1035]</td></tr>
<tr><td>DNF</td><td></td><td class='fixed-column'><b><a>Till STEINFORTH</b></a><br>Nebraska [JR]</td>
<td class='best1'><center><b>--<br></td><td>10.72 (5)</td></tr></table>"""


class FakeClock:
    def __init__(self):
        self.now = 0.0
        self.sleeps = []

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds


def fake_session(pages, statuses=None):
    """Serve pages by URL; statuses maps a URL to a list of status codes to return first."""
    statuses = {url: list(codes) for url, codes in (statuses or {}).items()}
    session = Mock()

    def get(url, **kwargs):
        assert kwargs["headers"]["User-Agent"] == USER_AGENT
        assert kwargs["timeout"] == (10, 45)
        code = statuses[url].pop(0) if statuses.get(url) else (200 if url in pages else 404)
        body = pages.get(url, "") if code == 200 else ""
        return Mock(status_code=code, text=body, content=body.encode("utf-8"))

    session.get.side_effect = get
    return session


def requested(session):
    return [call.args[0] for call in session.get.call_args_list]


class FetcherTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.cache = Path(self.tmp.name) / "results-cache"
        self.clock = FakeClock()

    def fetcher(self, session):
        return Fetcher(session=session, sleeper=self.clock.sleep, cache_dir=self.cache, clock=self.clock)

    def test_caches_pages_with_metadata_and_never_refetches(self):
        url = "https://www.flashresults.com/2026_Meets/Outdoor/06-10_NCAA/001-1_compiled.htm"
        session = fake_session({"https://www.flashresults.com/robots.txt": ROBOTS, url: "<p>page</p>"})
        self.assertEqual(self.fetcher(session).get(url), "<p>page</p>")
        path = self.cache / "www.flashresults.com/2026_Meets/Outdoor/06-10_NCAA/001-1_compiled.htm"
        meta = json.loads(path.with_name(path.name + ".meta.json").read_text())
        self.assertEqual(path.read_text(), "<p>page</p>")
        self.assertEqual((meta["url"], meta["status"]), (url, 200))
        self.assertEqual(len(meta["sha256"]), 64)
        self.assertIn("fetched", meta)
        again = fake_session({})
        self.assertEqual(self.fetcher(again).get(url), "<p>page</p>")
        self.assertEqual(requested(again), [])

    def test_waits_three_seconds_between_requests_to_a_host(self):
        base = "https://flashresults.ncaa.com/Outdoor/2025/"
        pages = {f"{base}{n}.htm": "x" for n in ("a", "b")}
        session = fake_session(pages, {"https://flashresults.ncaa.com/robots.txt": [403]})
        fetcher = self.fetcher(session)
        fetcher.get(f"{base}a.htm")
        self.clock.now += 1
        fetcher.get(f"{base}b.htm")
        self.assertEqual(self.clock.sleeps, [3, 2])

    def test_missing_robots_file_allows_and_robots_rules_are_obeyed(self):
        session = fake_session({"https://www.flashresults.com/robots.txt": ROBOTS})
        fetcher = self.fetcher(session)
        self.assertIsNone(fetcher.get("https://www.flashresults.com/2026_Meets/Outdoor/06-10_NCAA/results.pdf"))
        self.assertEqual(requested(session), ["https://www.flashresults.com/robots.txt"])
        s3 = fake_session({"https://flashresults.ncaa.com/x.htm": "ok"},
                          {"https://flashresults.ncaa.com/robots.txt": [403]})
        self.assertEqual(self.fetcher(s3).get("https://flashresults.ncaa.com/x.htm"), "ok")

    def test_robots_patterns_match_the_same_on_every_python(self):
        robots = Robots("User-agent: *\nDisallow: /*.pdf\nDisallow: /private/\nAllow: /private/open$\n\n"
                        "User-agent: other-bot\nDisallow: /\n")
        url = "https://www.flashresults.com"
        self.assertFalse(robots.can_fetch(USER_AGENT, f"{url}/2026_Meets/results.pdf"))
        self.assertTrue(robots.can_fetch(USER_AGENT, f"{url}/2026_Meets/results.htm"))
        self.assertFalse(robots.can_fetch(USER_AGENT, f"{url}/private/page.htm"))
        self.assertTrue(robots.can_fetch(USER_AGENT, f"{url}/private/open"))
        self.assertFalse(robots.can_fetch(USER_AGENT, f"{url}/private/open/more"))
        self.assertTrue(robots.can_fetch(USER_AGENT, f"{url}/index.htm"))
        self.assertFalse(robots.can_fetch("other-bot/1.0", f"{url}/index.htm"))

    def test_refusals_back_off_then_stop_the_host(self):
        url = "https://flashresults.ncaa.com/Outdoor/2025/index.htm"
        session = fake_session({url: "ok"}, {"https://flashresults.ncaa.com/robots.txt": [404],
                                            url: [429, 403, 403]})
        fetcher = self.fetcher(session)
        with self.assertRaises(HostBlocked):
            fetcher.get(url)
        self.assertIn(60, self.clock.sleeps)
        self.assertIn(120, self.clock.sleeps)
        with self.assertRaises(HostBlocked):
            fetcher.get("https://flashresults.ncaa.com/Outdoor/2025/other.htm")
        self.assertEqual(requested(session).count(url), 3)
        self.assertFalse(fetcher.path_for(url).exists())

    def test_a_refusal_followed_by_success_keeps_going(self):
        url = "https://flashresults.ncaa.com/a.htm"
        session = fake_session({url: "ok"}, {"https://flashresults.ncaa.com/robots.txt": [404], url: [429]})
        self.assertEqual(self.fetcher(session).get(url), "ok")
        self.assertIn(60, self.clock.sleeps)

    def test_missing_pages_are_remembered(self):
        url = "https://flashresults.ncaa.com/gone.htm"
        session = fake_session({}, {"https://flashresults.ncaa.com/robots.txt": [404]})
        self.assertIsNone(self.fetcher(session).get(url))
        again = fake_session({})
        self.assertIsNone(self.fetcher(again).get(url))
        self.assertEqual(requested(again), [])


class ParseTests(unittest.TestCase):
    def test_event_names_map_to_archive_names(self):
        cases = {"Men 100 M": ("m", "100 Meters"), "Women 10000 M": ("f", "10,000 Meters"),
                 "Men 110 M Hurdles": ("m", "110 Hurdles"), "Women 100 Meter Hurdles": ("f", "100 Hurdles"),
                 "Men 3000 M Steeple": ("m", "3000 Steeplechase"),
                 "Women 3000 Meter Steeplechase": ("f", "3000 Steeplechase"),
                 "Men 4x100 M Relay": ("m", "4 x 100 Relay"), "Women 4x400 Meter Relay": ("f", "4 x 400 Relay"),
                 "Men 800 Meter Run": ("m", "800 Meters"), "Women 200 Meter Dash": ("f", "200 Meters"),
                 "Men Hammer": ("m", "Hammer"), "Decathlon Spreadsheet": ("m", "Decathlon"),
                 "Men Heptathlon": ("f", "Heptathlon")}
        for label, expected in cases.items():
            self.assertEqual(event_name(label), expected, label)
        for label in ("Men Collegiate Wheelchair 100 M", "Women Wheelchair 100 M", "Men High Jump Off",
                      "Women Pole Vault Jump Off", "Decathlon 100 M", "Men 60 M", "Men 100 M Hurdles"):
            self.assertIsNone(event_name(label), label)

    def test_dates(self):
        self.assertEqual(parse_dates("Eugene, OR | June 11-14, 2025"), "2025-06-11")
        self.assertEqual(parse_dates("Hornet Stadium - Sacramento, CA | May 24-26, 2018"), "2018-05-24")
        self.assertIsNone(parse_dates("Eugene"))

    def test_index_keeps_championship_events_and_score_sheets(self):
        html = index_page("NCAA Outdoor Championships", "Eugene, OR | June 11-14, 2025", [
            ("Men 100 M", "Semis", "001-1_compiled.htm"), ("Men 100 M", "Final", "001-2_compiled.htm"),
            ("Men Long Jump", "Finals", "015-1_compiled.htm"),
            ("Decathlon 100 M", "Finals", "041-1_compiled.htm"),
            ("Decathlon Spreadsheet", " ", "041_Scores.htm"),
            ("Men Collegiate Wheelchair 100 M", "Final", "101-1_compiled.htm"),
            ("Men High Jump Off", "Final", "013-2_compiled.htm"),
            ("Men 100 M", "Final", "results.pdf")])
        index = parse_index(html, "https://flashresults.ncaa.com/Outdoor/2025/index.htm")
        self.assertEqual((index["name"], index["start_date"]), ("NCAA Outdoor Championships", "2025-06-11"))
        events = {e["event"]: e for e in index["events"]}
        self.assertEqual(sorted(events), ["100 Meters", "Decathlon", "Long Jump"])
        self.assertEqual(events["100 Meters"]["rounds"],
                         {1: "https://flashresults.ncaa.com/Outdoor/2025/001-1_compiled.htm",
                          2: "https://flashresults.ncaa.com/Outdoor/2025/001-2_compiled.htm"})
        self.assertEqual(events["Decathlon"]["rounds"],
                         {0: "https://flashresults.ncaa.com/Outdoor/2025/041_Scores.htm"})

    def test_old_index_header(self):
        html = ("<p class='meetNameTop'>NCAA West Preliminary Round</p><p class='meetDateTop'>Hornet"
                "\nStadium - Sacramento, CA |\nMay 24-26, 2018</p><table><tr><td>Friday</td><td>5 PM</td>"
                "<td>Women 400 M Hurdles</td><td>First Round</td><td><a href=\"030-1_compiled.htm\">Result</a>"
                "</td></tr></table>")
        index = parse_index(html, "https://www.ncaa.com/x/West/index.htm")
        self.assertEqual(index["name"], "NCAA West Preliminary Round")
        self.assertEqual(index["start_date"], "2018-05-24")
        self.assertEqual(index["events"][0]["event"], "400 Hurdles")

    def test_round_rows_with_markers_ids_and_statuses(self):
        html = round_page("Men 100 M (Quarterfinals)", [
            athlete(1, "Abdul-Rasheed Saminu", "South Florida", "9.86", "Q", "+0.6", "2 (1)", "8700013"),
            athlete(2, "Neo Mosebi", "FL State", "10.08 (10.076)", "q", "-0.2", "1 (3)"),
            athlete(3, "Darren McQueen", "Pittsburgh", "10.32", "", "+0.6", "2 (7)", "8320211"),
            athlete("", "Omari Lewis", "Liberty", "DNF", "", "", "2"),
            athlete("", "Jo Bloggs", "Duke", "DQ<br><small>R: 15.5-2b &#9432;</small>", "", "", "3")],
            caption="12 Advance: Top 3 from Each Heat plus Next 3 Fastest Times")
        result = parse_round(html)
        self.assertEqual((result["gender"], result["event"], result["round"]), ("m", "100 Meters", "quarterfinal"))
        rows = result["rows"]
        self.assertEqual(rows[0], {"place": 1, "name": "Abdul-Rasheed Saminu", "school": "South Florida",
                                   "class": "SR", "mark": "9.86", "wind": "+0.6", "q": "Q", "status": None,
                                   "tfrrs_id": "8700013", "heat": 2, "heat_place": 1, "points": None})
        self.assertEqual((rows[1]["name"], rows[1]["school"], rows[1]["mark"], rows[1]["q"], rows[1]["tfrrs_id"]),
                         ("Neo Mosebi", "FL State", "10.08", "q", None))
        self.assertEqual(rows[2]["name"], "Darren McQueen")
        self.assertEqual([(r["place"], r["mark"], r["status"]) for r in rows[3:]],
                         [(None, None, "DNF"), (None, None, "DQ")])

    def test_final_wind_comes_from_the_caption(self):
        html = round_page("Men 100 M (Final)", [athlete(1, "Jordan Anthony", "Arkansas", "10.07", "", "")],
                          caption="Wind: <font color=#007600>+0.7</font> m/s")
        row = parse_round(html)["rows"][0]
        self.assertEqual((row["mark"], row["wind"], row["heat"]), ("10.07", "+0.7", 1))
        self.assertEqual(parse_round(html)["round"], "final")

    def test_field_event_best_mark_flight_and_fouls(self):
        html = round_page("Men Long Jump (First Round)", [
            athlete(1, "Louis Gordon", "UAlbany", "7.83m 25-8¼", "q", "+0.3", "3 (1) PB", "7486888"),
            athlete(2, "Ann Jumper", "Kentucky", "7.40m", "q (won JO)", "+0.1"),
            athlete(2, "Bea Jumper", "Kentucky", "7.40m", "JOq", "+0.1"),
            athlete(2, "Cat Jumper", "Kentucky", "7.40m", "(JO)", "+0.1"),
            athlete("", "Marc Morrison", "Connecticut", "X", "", "", "3")],
            caption="Top 12 Advance to Eugene", mark_header="Best Jump")
        rows = parse_round(html)["rows"]
        self.assertEqual([r["q"] for r in rows[1:4]], ["q", "q", None])
        rows = [rows[0], rows[-1]]
        self.assertEqual((rows[0]["mark"], rows[0]["wind"], rows[0]["q"], rows[0]["heat"], rows[0]["heat_place"]),
                         ("7.83", "+0.3", "q", 3, 1))
        self.assertEqual((rows[1]["mark"], rows[1]["status"]), (None, "NM"))

    def test_relay_uses_the_school_as_the_name(self):
        html = round_page("Men 4x100 M Relay (Quarterfinals)",
                          [relay(1, "South Florida", "38.05", "Q"), relay("", "Clemson", "FS")],
                          name_header="Team")
        rows = parse_round(html)["rows"]
        self.assertEqual((rows[0]["name"], rows[0]["school"], rows[0]["q"], rows[0]["wind"]),
                         ("South Florida", "South Florida", "Q", None))
        self.assertEqual(rows[1]["status"], "FS")

    def test_old_layout_with_affiliation_column(self):
        result = parse_round(OLD_ROUND)
        self.assertEqual((result["event"], result["round"]), ("100 Meters", "prelim"))
        first, second, dns = result["rows"]
        self.assertEqual((first["name"], first["school"], first["class"], first["mark"], first["q"],
                          first["wind"], first["tfrrs_id"]),
                         ("Divine Oduduru", "Texas Tech", "JR", "9.96", "Q", "+2.4", "6166402"))
        self.assertEqual((second["name"], second["q"], second["tfrrs_id"]), ("Hakim Sani Brown", "q", None))
        self.assertEqual((dns["place"], dns["status"], dns["school"]), (None, "DNS", "Western Carolina"))
        rows = parse_round(OLD_RELAY)["rows"]
        self.assertEqual([(r["name"], r["school"], r["q"], r["status"]) for r in rows],
                         [("Purdue", "Purdue", "Q", None), ("Jackson State", "Jackson State", None, "DQ")])

    def test_combined_event_score_sheet(self):
        result = parse_round(SCORES)
        self.assertEqual((result["gender"], result["event"], result["round"]), ("m", "Decathlon", "final"))
        winner, dnf = result["rows"]
        self.assertEqual((winner["place"], winner["name"], winner["school"], winner["mark"], winner["tfrrs_id"]),
                         (1, "Peyton Bair", "Miss State", "8323", "8238359"))
        self.assertEqual((dnf["place"], dnf["name"], dnf["school"], dnf["mark"], dnf["status"]),
                         (None, "Till Steinforth", "Nebraska", None, "DNF"))


BASE = "https://flashresults.ncaa.com/Outdoor/2025/"
EAST = BASE + "FirstRounds/East/"
WEST = BASE + "FirstRounds/West/"
CONFIG = {"2025": {"east": EAST + "index.htm", "west": WEST + "index.htm", "nationals": BASE + "index.htm",
                   "meet": {"name": "NCAA Outdoor Championships", "start_date": "2025-06-11"}}}


def season_pages():
    pages = {"https://flashresults.ncaa.com/robots.txt": ""}
    for region, base in (("East", EAST), ("West", WEST)):
        pages[base + "index.htm"] = index_page(f"NCAA {region} First Round", "May 28-31, 2025", [
            ("Men 100 M", "First Round", "001-1_compiled.htm"),
            ("Men 100 M", "Quarterfinals", "001-2_compiled.htm"),
            ("Men Pole Vault", "First Round", "014-1_compiled.htm"),
            ("Men Pole Vault", "First Round", "114-1_compiled.htm")])
        pages[base + "014-1_compiled.htm"] = round_page("Men Pole Vault (First Round)", [
            athlete(1, f"{region} Vaulter", "Duke", "5.50m 18-½", "q", "")], mark_header="Best")
        pages[base + "114-1_compiled.htm"] = round_page("Men Pole Vault Jump Off (First Round)", [
            athlete(1, f"{region} Vaulter", "Duke", "5.30m 17-4¾", "", "")], mark_header="Best")
        pages[base + "001-2_compiled.htm"] = round_page("Men 100 M (Quarterfinals)", [
            athlete(1, f"{region} Winner", "Auburn", "9.95", "Q", tfrrs="1" if region == "East" else "2"),
            athlete(2, f"{region} Second", "LSU", "10.01", "q"),
            athlete(3, f"{region} Third", "Iowa", "10.20", "")])
    pages[BASE + "index.htm"] = index_page("NCAA Outdoor Championships", "Eugene, OR | June 11-14, 2025", [
        ("Men 100 M", "Semis", "001-1_compiled.htm"), ("Men 100 M", "Final", "001-2_compiled.htm"),
        ("Decathlon Spreadsheet", "", "041_Scores.htm"), ("Women Wheelchair 100 M", "Final", "121-1_compiled.htm")])
    # Some years label the first round at nationals "Prelims"; it is still the semifinal.
    pages[BASE + "001-1_compiled.htm"] = round_page("Men 100 M (Prelims)", [
        athlete(1, "East Winner", "Auburn", "9.92", "Q", tfrrs="1"),
        athlete(2, "West Winner", "Auburn", "9.99", "Q", tfrrs="2"),
        athlete(3, "East Second", "LSU", "10.10", ""),
        athlete("", "West Second", "LSU", "DNS", "", "")])
    pages[BASE + "001-2_compiled.htm"] = round_page("Men 100 M (Final)", [
        athlete(1, "West Winner", "Auburn", "10.07", "", "", tfrrs="2"),
        athlete("", "East Winner", "Auburn", "DNF", "", "", tfrrs="1")], caption="Wind: +0.7 m/s")
    pages[BASE + "041_Scores.htm"] = SCORES
    return pages


class SeasonTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.cache = Path(self.tmp.name) / "results-cache"

    def test_fetch_meet_skips_non_championship_events_and_can_fetch_last_rounds_only(self):
        session = fake_session(season_pages())
        paths = fetch_meet(BASE + "index.htm", session=session, sleeper=lambda _: None, cache_dir=self.cache)
        self.assertEqual(len(paths), 4)
        self.assertNotIn(BASE + "121-1_compiled.htm", requested(session))
        session = fake_session(season_pages())
        fetch_meet(EAST + "index.htm", session=session, sleeper=lambda _: None, cache_dir=self.cache,
                   rounds="last")
        self.assertNotIn(EAST + "001-1_compiled.htm", requested(session))
        self.assertIn(EAST + "001-2_compiled.htm", requested(session))
        self.assertIn(EAST + "014-1_compiled.htm", requested(session))

    def test_season_results_join_rounds_and_regions(self):
        session = fake_session(season_pages())
        data = season_results("2025", CONFIG, session=session, sleeper=lambda _: None, cache_dir=self.cache)
        self.assertEqual(data["meet"], CONFIG["2025"]["meet"])
        sprint = next(e for e in data["events"] if e["event"] == "100 Meters")
        self.assertEqual(sprint["first_round"]["East"]["round"], "Quarterfinals")
        self.assertEqual(sprint["first_round"]["East"]["advanced"], 2)
        self.assertEqual([r["name"] for r in sprint["first_round"]["West"]["rows"] if r["q"]],
                         ["West Winner", "West Second"])
        nationals = {a["name"]: a for a in sprint["nationals"]}
        self.assertEqual(len(nationals), 4)
        self.assertEqual({k: nationals["West Winner"][k] for k in ("round", "place", "mark", "wind", "status")},
                         {"round": "final", "place": 1, "mark": "10.07", "wind": "+0.7", "status": None})
        self.assertEqual({k: nationals["East Winner"][k] for k in ("round", "place", "mark", "status", "tfrrs_id")},
                         {"round": "final", "place": None, "mark": None, "status": "DNF", "tfrrs_id": "1"})
        self.assertEqual({k: nationals["East Second"][k] for k in ("round", "place", "mark")},
                         {"round": "semifinal", "place": None, "mark": "10.10"})
        self.assertEqual(nationals["West Second"]["status"], "DNS")
        self.assertEqual([a["name"] for a in sprint["nationals"]],
                         ["West Winner", "East Winner", "East Second", "West Second"])
        self.assertEqual([(r["round"], r["label"]) for r in sprint["nationals_rounds"]],
                         [("semifinal", "Prelims"), ("final", "Final")])
        vault = next(e for e in data["events"] if e["event"] == "Pole Vault")
        self.assertEqual(vault["first_round"]["West"]["url"], WEST + "014-1_compiled.htm")
        self.assertEqual(vault["first_round"]["West"]["rows"][0]["mark"], "5.50")
        self.assertEqual(sorted(s["url"] for s in data["skipped"]),
                         [EAST + "114-1_compiled.htm", WEST + "114-1_compiled.htm"])
        decathlon = next(e for e in data["events"] if e["event"] == "Decathlon")
        self.assertEqual(decathlon["first_round"], {})
        self.assertEqual(decathlon["nationals"][0]["mark"], "8323")
        warnings = season_checks(data)
        self.assertIn("2025 m 100 Meters: 2 East advancers", warnings)
        self.assertIn("2025 m 100 Meters: 4 nationals entrants", warnings)
        self.assertFalse([w for w in warnings if "Decathlon" in w])
        offline = season_results("2025", CONFIG, fetcher=CacheOnly(cache_dir=self.cache))
        self.assertEqual(offline, data)


if __name__ == "__main__":
    unittest.main()
