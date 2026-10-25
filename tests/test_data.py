import copy
from datetime import date, timedelta
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlparse

import requests

from validate_data import validate_data
from tfrrs_data import (collect, compact, derive_files, expand, get_cutoff_rank, load_archive, load_championships, load_config,
                        load_records, merge_records, parse_page, publish, record_key, run_scrape,
                        validate_config)

CFG = dict(year="2025-2026", season="indoor", region="National", list_id="5352", list_name="Indoor_List")
CONFIG = {"active": [CFG], "historical": [dict(CFG, year="2024-2025")]}
SEASON = ("indoor", "2025-2026")
CHAMPIONSHIP = {"indoor": {"2025-2026": {"name": "NCAA indoor championships", "source": "https://example.com",
                                         "start_date": "2026-03-13"}}}
SCOPE = "site/indoor-2025-2026-m-National.json"


def record(year="2025-2026", gender="m", performance="45.00", event="400 Meters", count=1):
    return dict(year=year, season="indoor", region="National", gender=gender, event=event,
                rankings=[dict(rank=rank, athlete=f"Runner {rank}" if rank > 1 else "Runner", team="School",
                               time=performance) for rank in range(1, count + 1)])


def read(data, name):
    return json.loads((data / name).read_text())


def html(performance="45.00", count=1, cfg=CFG, gender="m", limit=None):
    row = (f'<div class="performance-list-row"><div data-label="Athlete">Runner</div>'
           f'<div data-label="Team">School</div><div data-label="Time">{performance}</div></div>')
    title = (f"{cfg['year']} NCAA Division I " +
             (f"{cfg['region']} " if cfg['region'] != 'National' else '') +
             f"{cfg['season'].title()} Qualifying List")
    return (f'<h3 class="panel-title">{title}</h3>'
            f'<form id="list_filter" action="/list_data/{cfg["list_id"]}"></form>'
            f'<select name="gender"><option selected value="{gender}"></option></select>'
            + (f'<select name="limit"><option value="50"></option><option selected value="{limit}"></option></select>'
               if limit else '') +
            '<div class="custom-table-title"><h3>Men\'s 400 Meters (Final)</h3></div>'
            '<div class="performance-list">' + row * count + '</div>')


def response(body=None, failure=None, status=200):
    result = Mock(text=body if body is not None else html(), status_code=status)
    result.raise_for_status.side_effect = failure
    return result


def files_in(directory):
    return {str(p.relative_to(directory)): p.read_bytes() for p in directory.rglob('*') if p.is_file()}


def session_for(configs=(CFG,), performance="45.00", count=1):
    session = Mock()

    def get(url, **kwargs):
        parsed = urlparse(url)
        cfg = next(c for c in configs if c['list_id'] == parsed.path.split('/')[2])
        query = parse_qs(parsed.query)
        limit = query.get('limit', [None])[0]
        return response(html(performance, count, cfg=cfg, gender=query['gender'][0], limit=limit))

    session.get.side_effect = get
    return session


class DataTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name) / "data"
        self.data.mkdir()
        self.seed = [record(), record(gender="f"), record("2025-2026 (2026-10-01)")]
        self.checked = {SEASON: ["2026-10-01"]}
        publish(self.seed, self.checked, CONFIG, self.data, championships={})

    def scrape(self, **kwargs):
        session = kwargs.pop("session", None)
        if session is None:
            session = session_for(CONFIG[kwargs.get('mode', 'active')])
        kwargs.setdefault("championships", {})
        return run_scrape(data_dir=self.data, config=CONFIG, session=session,
                          sleeper=lambda _: None, **kwargs)

    def test_consecutive_days_keep_every_day_but_store_only_changes(self):
        self.scrape(today="2026-10-02")
        self.scrape(today="2026-10-03")
        session = session_for(performance="44.50")
        self.scrape(today="2026-10-04", session=session)
        records, checked = load_archive(self.data)
        days = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]
        self.assertEqual(checked, {SEASON: days})
        # The third day matched the second, so it isn't stored again.
        stored = [r["year"] for r in records if r["gender"] == "m" and "(" in r["year"]]
        self.assertEqual(stored, [f"2025-2026 ({day})" for day in days if day != "2026-10-03"])
        self.assertEqual([r["year"] for r in expand(records, checked) if r["gender"] == "m"],
                         [f"2025-2026 ({day})" for day in days])
        scope = read(self.data, SCOPE)
        self.assertEqual({row["time"] for row in scope["events"][0]["rankings"]}, {"44.50"})
        self.assertEqual([point[0] for point in scope["events"][0]["series"]], days)
        self.assertEqual(scope["listDate"], "2026-10-04")

    def test_same_day_rerun_replaces_without_duplicates_and_noop_is_stable(self):
        self.scrape(today="2026-10-02")
        session = session_for(performance="44.50")
        records = self.scrape(today="2026-10-02", session=session)
        self.assertEqual(len(records), len({record_key(r) for r in records}))
        before = files_in(self.data)
        self.scrape(today="2026-10-02", session=session)
        self.assertEqual(before, files_in(self.data))
        records, checked = load_archive(self.data)
        self.assertEqual(publish(records, checked, CONFIG, self.data, championships={}), 0)

    def test_an_event_that_leaves_the_list_is_not_carried_forward(self):
        def other_event(url, **kwargs):
            gender = parse_qs(urlparse(url).query)['gender'][0]
            return response(html(gender=gender).replace('400 Meters', '800 Meters'))

        session = Mock()
        session.get.side_effect = other_event
        self.scrape(today="2026-10-02", session=session)
        self.scrape(today="2026-10-03", session=session)
        records, checked = load_archive(self.data)
        gone = [r for r in records if r["event"] == "400 Meters" and r["gender"] == "m" and r["rankings"] is None]
        self.assertEqual([r["year"] for r in gone], ["2025-2026 (2026-10-02)"])
        days = [r["year"] for r in expand(records, checked) if r["event"] == "400 Meters" and r["gender"] == "m"]
        self.assertEqual(days, ["2025-2026 (2026-10-01)"])

    def test_finished_seasons_are_not_collected_again(self):
        before = files_in(self.data / "archive")
        session = session_for()
        self.scrape(today="2026-03-27", session=session, championships=CHAMPIONSHIP)
        session.get.assert_not_called()
        self.assertEqual(before, files_in(self.data / "archive"))
        # Up to two weeks after the championship starts, the season is still collected.
        self.scrape(today="2026-03-26", session=session, championships=CHAMPIONSHIP)
        self.assertEqual(session.get.call_count, 2)

    def test_season_chart_stops_before_the_championship(self):
        records = [record(count=16), record("2025-2026 (2026-03-12)", count=16, performance="44.90"),
                   record("2025-2026 (2026-03-13)", count=16, performance="44.80")]
        checked = {SEASON: ["2026-03-11", "2026-03-12", "2026-03-13"]}
        files = derive_files(records, checked, CONFIG, CHAMPIONSHIP)
        scope = files[SCOPE]
        event = scope["events"][0]
        self.assertEqual(event["series"], [["2026-03-12", "44.90", 16]])
        self.assertTrue(event["afterMeet"])
        self.assertEqual((scope["listDate"], scope["final"]), ("2026-03-12", True))
        self.assertEqual(scope["championship"], CHAMPIONSHIP["indoor"]["2025-2026"])
        self.assertEqual(files["site/days-indoor-2025-2026-m-National.json"],
                         {"400 Meters": [["2026-03-12", [["44.90", "Runner"]] + [["44.90", f"Runner {rank}"] for rank in range(2, 17)]]]})

    def test_each_configured_championship_ends_its_chart_the_day_before(self):
        championships = load_championships()
        for season, seasons in championships.items():
            for year, championship in seasons.items():
                with self.subTest(season=season, year=year):
                    start = championship["start_date"]
                    before = (date.fromisoformat(start) - timedelta(days=1)).isoformat()
                    region = "National" if season == "indoor" else "East"
                    final = dict(record(year), season=season, region=region)
                    days = [dict(final, year=f"{year} ({day})") for day in (before, start)]
                    config = {"active": [dict(CFG, year=year, season=season, region=region)]}
                    scope = derive_files([final, *days], {(season, year): [before, start]}, config,
                                         championships)[f"site/{season}-{year}-m-{region}.json"]
                    self.assertEqual([point[0] for point in scope["events"][0]["series"]], [before])
                    self.assertEqual((scope["listDate"], scope["final"]), (before, True))

    def test_a_season_without_a_configured_championship_keeps_every_day(self):
        config = {"active": [dict(CFG, year="2028-2029")]}
        records = [record("2028-2029"), record("2028-2029 (2029-02-01)"), record("2028-2029 (2029-03-20)", performance="44.00")]
        scope = derive_files(records, {("indoor", "2028-2029"): ["2029-02-01", "2029-03-20"]}, config,
                             load_championships())["site/indoor-2028-2029-m-National.json"]
        self.assertIsNone(scope["championship"])
        self.assertEqual([point[0] for point in scope["events"][0]["series"]], ["2029-02-01", "2029-03-20"])
        self.assertEqual((scope["listDate"], scope["final"]), ("2029-03-20", False))

    def test_saved_days_keep_the_top_twenty_only_when_they_change(self):
        top = record("2025-2026 (2026-01-02)", count=25)
        lower = copy.deepcopy(top)
        lower["year"] = "2025-2026 (2026-01-03)"
        lower["rankings"][-1]["time"] = "46.00"
        files = derive_files([record(), top, lower], {SEASON: ["2026-01-02", "2026-01-03"]}, CONFIG, {})
        days = files["site/days-indoor-2025-2026-m-National.json"]["400 Meters"]
        self.assertEqual([day for day, _ in days], ["2026-01-02"])
        self.assertEqual(len(days[0][1]), 20)
        self.assertEqual([point[0] for point in files[SCOPE]["events"][0]["series"]], ["2026-01-02", "2026-01-03"])

    def test_failed_second_page_never_publishes_partial_results(self):
        before = files_in(self.data)
        session = Mock()
        session.get.side_effect = [response()] + [response(failure=requests.HTTPError("503"))] * 3
        with self.assertRaises(requests.HTTPError):
            self.scrape(today="2026-10-02", session=session)
        self.assertEqual(before, files_in(self.data))
        self.assertEqual(session.get.call_count, 4)

    def test_retries_timeout_and_success(self):
        session = Mock()
        session.get.side_effect = [requests.Timeout(), requests.ConnectionError(), response(), response(html(gender='f'))]
        collected = collect([CFG], session=session, sleeper=lambda _: None)
        self.assertEqual(len(collected), 2)
        self.assertEqual(session.get.call_count, 4)
        self.assertEqual(session.get.call_args.kwargs['timeout'], (10, 45))

    def test_timeout_attempts_are_bounded_and_preserve_files(self):
        before = files_in(self.data)
        session = Mock()
        session.get.side_effect = requests.Timeout()
        with self.assertRaises(requests.Timeout):
            self.scrape(session=session)
        self.assertEqual(session.get.call_count, 3)
        self.assertEqual(before, files_in(self.data))

    def test_blocked_malformed_empty_and_missing_cells_fail_without_writes(self):
        for body in ["<html>Access denied</html>", '<div class="custom-table-title"></div>',
                     html(count=0), html().replace('data-label="Time"', 'data-label="Other"')]:
            with self.subTest(body=body):
                before = files_in(self.data)
                session = Mock()
                session.get.return_value = response(body)
                with self.assertRaises(ValueError):
                    self.scrape(session=session)
                self.assertEqual(before, files_in(self.data))

    def test_corrupt_and_missing_archive_fail_before_network_requests(self):
        session = Mock()
        path = self.data / "archive/indoor/2025-2026.json"
        path.write_text('{broken')
        before = files_in(self.data)
        with self.assertRaises(ValueError):
            self.scrape(session=session)
        self.assertEqual(before, files_in(self.data))
        path.unlink()
        with self.assertRaises(FileNotFoundError):
            self.scrape(session=session)
        session.get.assert_not_called()

    def test_generation_failure_does_not_publish(self):
        before = files_in(self.data)
        with patch('tfrrs_data.derive_files', side_effect=ValueError('bad generated data')):
            with self.assertRaises(ValueError):
                self.scrape(today="2026-10-02")
        self.assertEqual(before, files_in(self.data))

    def test_replacement_failure_rolls_back_files(self):
        before = files_in(self.data)
        replace = os.replace
        calls = 0

        def fail_second(source, target):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError('disk error')
            replace(source, target)

        with patch('tfrrs_data.os.replace', side_effect=fail_second):
            with self.assertRaises(OSError):
                publish(merge_records(self.seed, [record("2025-2026 (2026-10-02)", performance="44.00")]),
                        {SEASON: ["2026-10-01", "2026-10-02"]}, CONFIG, self.data, championships={})
        self.assertEqual(before, files_in(self.data))

    def test_historical_backfill_adds_no_artificial_dates(self):
        self.scrape(mode="historical")
        records, checked = load_archive(self.data)
        self.assertEqual(checked, {SEASON: ["2026-10-01"]})
        self.assertIn("2024-2025", {r['year'] for r in records})

    def test_real_configuration_collects_all_eight_pages(self):
        config = load_config()
        session = session_for(config['active'])
        rows = collect(config['active'], session=session, sleeper=lambda _: None)
        self.assertEqual(session.get.call_count, len(config['active']) * 2)
        self.assertEqual(len({record_key(r) for r in rows}), len(config['active']) * 2)
        self.assertTrue({(c['year'], c['season'], c['region']) for c in config['active']}.issubset(
            {(c['year'], c['season'], c['region']) for c in config['historical']}))

    def test_configured_year_controls_active_selection(self):
        config = copy.deepcopy(CONFIG)
        config['active'][0]['year'] = '2026-2027'
        files = derive_files([record(), record('2026-2027')], {}, config, {})
        self.assertEqual([(e['year'], e['current']) for e in files['site/index.json']['lists'] if e['gender'] == 'm'],
                         [('2026-2027', True)])

    def test_past_lists_hold_final_lists_of_earlier_configured_seasons(self):
        files = derive_files([record(), record('2024_2025'), record('2024-2025 (2025-02-01)'),
                              record('2023-2024')], {("indoor", "2024-2025"): ["2025-02-01"]}, CONFIG, {})
        lists = [e for e in files['site/index.json']['lists'] if e['gender'] == 'm']
        self.assertEqual([(e['year'], e['current']) for e in lists], [('2024-2025', False), ('2025-2026', True)])
        self.assertEqual(lists[0]['source'], dict(list_id='5352', list_name='Indoor_List'))
        past = files[f"site/{lists[0]['file']}"]
        self.assertEqual(past['events'][0]['qualification']['rank'], 16)

    def test_past_lists_leave_out_seasons_hidden_from_the_site(self):
        config = copy.deepcopy(CONFIG)
        config['historical'][0]['show_on_site'] = False
        index = derive_files([record(), record('2024_2025')], {}, config, {})['site/index.json']
        self.assertEqual({e['year'] for e in index['lists']}, {'2025-2026'})
        config['historical'][0]['show_on_site'] = 'no'
        with self.assertRaises(ValueError):
            validate_config(config)

    def test_past_cutoffs_split_by_season_and_gender(self):
        past = {"lines": [dict(season="indoor", gender="m", event="Mile", year="2024-2025"),
                          dict(season="outdoor", gender="f", event="Mile", year="2025")]}
        files = derive_files([record()], {}, CONFIG, {}, past)
        self.assertEqual(files['site/history-indoor-m.json'], {"lines": [past["lines"][0]]})
        self.assertEqual(files['site/history-indoor-f.json'], {"lines": []})
        self.assertEqual(files['site/index.json']['history']['outdoor-f'], 'history-outdoor-f.json')

    def test_cutoff_rules_and_missing_rank_remains_unavailable(self):
        for event, season, region, expected in [
            ('400 Meters', 'indoor', 'National', 16),
            ('4x400 Relay', 'indoor', 'National', 12),
            ('Distance Medley Relay', 'indoor', 'National', 12),
            ('400 Meters', 'outdoor', 'East', 48),
            ('4x400 Relay', 'outdoor', 'West', 24),
            ('Decathlon', 'outdoor', 'National', 24),
        ]:
            self.assertEqual(get_cutoff_rank(event, season, region), expected)
        self.assertIsNone(get_cutoff_rank('Mile', 'indoor', 'National', '2009-2010'))
        self.assertIsNone(get_cutoff_rank('4 x 400 Relay', 'indoor', 'National', '2011-2012'))
        self.assertEqual(get_cutoff_rank('Mile', 'indoor', 'National', '2012-2013'), 16)
        self.assertEqual(get_cutoff_rank('Distance Medley Relay', 'indoor', 'National', '2019-2020'), 12)
        # 2021 regionals were restored to 48 individuals; relays stayed at 24.
        self.assertEqual(get_cutoff_rank('1500 Meters', 'outdoor', 'East', '2021'), 48)
        self.assertEqual(get_cutoff_rank('4 x 400 Relay', 'outdoor', 'West', '2021'), 24)
        self.assertEqual(get_cutoff_rank('Heptathlon', 'outdoor', 'East', '2010'), 24)
        self.assertEqual(get_cutoff_rank('Decathlon', 'outdoor', 'National', '2025'), 24)
        files = derive_files([record(), record("2025-2026 (2026-01-02)")], {SEASON: ["2026-01-02"]}, CONFIG, {})
        event = files[SCOPE]['events'][0]
        self.assertEqual(event['qualification']['rank'], 16)
        self.assertEqual(event['qualification']['status'], 'missing_rank')
        # A day whose list doesn't reach the spot has no mark, and says how many marks it held.
        self.assertEqual(event['series'], [["2026-01-02", None, 1]])

    def test_legacy_records_can_omit_team_and_normalize_year_for_dedup(self):
        old = record('2025_2026')
        old['rankings'][0]['rank'] = 16
        del old['rankings'][0]['team']
        entry = derive_files([old], {}, CONFIG, {})[SCOPE]['events'][0]['qualification']['entry']
        self.assertNotIn('team', entry)
        self.assertEqual(len(merge_records([old], [record()])), 1)

    def test_place_column_keeps_ties_and_conversion_tooltip(self):
        def row(place, mark, flag="", title=""):
            tip = f'<span title="{title}">' if title else ""
            end = "</span>" if title else ""
            flag_html = f"<span>{flag}</span>" if flag else ""
            return (f'<div class="performance-list-row"><div data-label="Place">{place}</div>'
                    f'<div data-label="Athlete">Runner</div><div data-label="Team">School</div>'
                    f'<div data-label="Time">{tip}<a>{mark}</a>{flag_html}{end}</div></div>')

        body = html(count=0).replace(
            '<div class="performance-list"></div>',
            '<div class="performance-list">'
            + row(15, "3:58.76")
            + row(15, "3:58.76")
            + row(16, "3:59.17", "@", "Converted from 4:04.44 for Altitude. ")
            + row(18, "6.66", "(55)", "Converted  from 6.20 (55)")
            + "</div>")
        rankings = parse_page(body, CFG, "m")[0]["rankings"]
        self.assertEqual([item["rank"] for item in rankings], [1, 2, 3, 4])
        self.assertEqual([item["place"] for item in rankings], [15, 15, 16, 18])
        self.assertEqual(rankings[2]["time"], "3:59.17")
        self.assertEqual(rankings[2]["flag"], "@")
        self.assertEqual(rankings[2]["converted"], "Converted from 4:04.44 for Altitude")
        self.assertEqual(rankings[3]["time"], "6.66")
        self.assertEqual(rankings[3]["flag"], "(55)")
        self.assertEqual(rankings[3]["conversion"], None)
        self.assertEqual(rankings[2]["conversion"], "altitude")
        self.assertIsNone(rankings[0]["conversion"])
        self.assertNotIn("flag", rankings[0])

    def test_hash_and_altitude_flags_parse_without_losing_either(self):
        from tfrrs_data import mark_conversion

        def row(place, mark, flag="", title=""):
            tip = f'<span title="{title}">' if title else ""
            end = "</span>" if title else ""
            flag_html = f"<span>{flag}</span>" if flag else ""
            return (f'<div class="performance-list-row"><div data-label="Place">{place}</div>'
                    f'<div data-label="Athlete">Runner</div><div data-label="Team">School</div>'
                    f'<div data-label="Time">{tip}<a>{mark}</a>{flag_html}{end}</div></div>')

        body = html(count=0).replace(
            '<div class="performance-list"></div>',
            '<div class="performance-list">'
            + row(1, "45.27")
            + row(2, "45.10", "#", "Converted from 45.40 for Track Size")
            + row(3, "53.76", "#@")
            + row(4, "3:59.13 @#")
            + "</div>")
        rankings = parse_page(body, CFG, "m")[0]["rankings"]
        self.assertEqual([item["time"] for item in rankings], ["45.27", "45.10", "53.76", "3:59.13"])
        self.assertEqual([item["conversion"] for item in rankings], [None, "flat", "both", "both"])
        self.assertEqual(rankings[1]["flag"], "#")
        self.assertEqual(rankings[2]["flag"], "#@")
        self.assertEqual(rankings[3]["flag"], "@#")
        self.assertNotIn("flag", rankings[0])
        self.assertEqual(mark_conversion("7.83", "@(55)"), "altitude")
        self.assertIsNone(mark_conversion("6.66", "(55)"))
        self.assertIsNone(mark_conversion("3:58.66"))
        self.assertEqual(mark_conversion("6.57", stored="altitude"), "altitude")

    def test_parser_caps_sixty_and_preserves_event_name(self):
        result = parse_page(html(count=65), CFG, 'm')[0]
        self.assertEqual(result['event'], '400 Meters')
        self.assertEqual(len(result['rankings']), 60)
        self.assertEqual(result['rankings'][-1]['rank'], 60)

    def test_real_relay_field_and_points_layouts_keep_existing_json_keys(self):
        relay = html().replace('400 Meters', '4 x 400 Relay').replace(
            '<div data-label="Athlete">Runner</div>', '<div data-label="Athletes">Relay runners</div>')
        result = parse_page(relay, CFG, 'm')[0]
        self.assertEqual(result['rankings'][0]['athlete'], 'School')
        for label, event in [('Mark', 'High Jump'), ('Points', 'Heptathlon')]:
            body = html('2.20').replace('400 Meters', event).replace('data-label="Time"', f'data-label="{label}"')
            result = parse_page(body, CFG, 'm')[0]
            self.assertEqual(result['rankings'][0]['time'], '2.20')

    def test_field_marks_keep_metric_mark_beside_imperial_conversion_column(self):
        # The original scraper read only Time, saving every 2023-24/2024-25 field mark as N/A.
        link = '<a href="https://tf.tfrrs.org/results/83020/5018242/Meet/High-Jump">{}</a>'
        field = html().replace('400 Meters', 'High Jump').replace(
            '<div data-label="Time">45.00</div>',
            f'<div class="col-narrow" data-label="Mark">{link.format("2.27m")}</div>'
            f'<div class="col-narrow" data-label="Conv">{link.format("7&#39; 5.25&quot;")}</div>')
        multi = html().replace('400 Meters', 'Heptathlon').replace(
            '<div data-label="Time">45.00</div>', f'<div data-label="Points">{link.format("6219")}</div>')
        self.assertEqual(parse_page(field, CFG, 'm')[0]['rankings'][0]['time'], '2.27m')
        self.assertEqual(parse_page(multi, CFG, 'm')[0]['rankings'][0]['time'], '6219')

    def test_archive_stores_one_file_per_season_and_reads_back_the_same(self):
        records, checked = load_archive(self.data)
        self.assertEqual(records, compact(self.seed))
        self.assertEqual(checked, self.checked)
        self.assertEqual(sorted(str(p.relative_to(self.data)) for p in (self.data / 'archive').rglob('*.json')),
                         ['archive/indoor/2025-2026.json'])
        self.assertEqual(load_records(self.data), records)

    def test_publishing_removes_site_files_that_are_no_longer_shown(self):
        stale = self.data / 'site/indoor-2019-2020-m-National.json'
        stale.write_text('{}')
        publish(*load_archive(self.data), CONFIG, self.data, championships={})
        self.assertFalse(stale.exists())

    def test_validation_detects_stale_published_files_without_rewriting_them(self):
        validate_data(self.data, CONFIG, {})
        path = self.data / SCOPE
        path.write_text(path.read_text().replace('45.00', '44.00'))
        before = files_in(self.data)
        with self.assertRaisesRegex(ValueError, 'Stale published data'):
            validate_data(self.data, CONFIG, {})
        self.assertEqual(before, files_in(self.data))
        publish(*load_archive(self.data), CONFIG, self.data, championships={})
        (self.data / 'site/extra.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'no longer published'):
            validate_data(self.data, CONFIG, {})

    def test_invalid_configuration_is_rejected(self):
        for mutate in [lambda c: c.update(active=[]),
                       lambda c: c['active'].append(c['active'][0]),
                       lambda c: c['active'][0].update(list_name='../wrong')]:
            cfg = copy.deepcopy(CONFIG)
            mutate(cfg)
            path = Path(self.tmp.name) / 'config.json'
            path.write_text(json.dumps(cfg))
            with self.assertRaises(ValueError):
                load_config(path)


if __name__ == '__main__':
    unittest.main()
