import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlparse

import requests

from recover_history import recover_records
from validate_data import validate_data
from tfrrs_data import (MASTER, collect, derive_files, get_cutoff_rank, load_config,
                        load_records, merge_records, parse_page, publish, record_key, run_scrape)

CFG = dict(year="2025-2026", season="indoor", region="National", list_id="5352", list_name="Indoor_List")
CONFIG = {"active": [CFG], "historical": [dict(CFG, year="2024-2025")]}


def record(year="2025-2026", gender="m", performance="45.00"):
    return dict(year=year, season="indoor", region="National", gender=gender,
                event="400 Meters", rankings=[dict(rank=1, athlete="Runner", team="School", time=performance)])


def html(performance="45.00", count=1, cfg=CFG, gender="m"):
    row = (f'<div class="performance-list-row"><div data-label="Athlete">Runner</div>'
           f'<div data-label="Team">School</div><div data-label="Time">{performance}</div></div>')
    title = (f"{cfg['year']} NCAA Division I " +
             (f"{cfg['region']} " if cfg['region'] != 'National' else '') +
             f"{cfg['season'].title()} Qualifying List")
    return (f'<h3 class="panel-title">{title}</h3>'
            f'<form id="list_filter" action="/list_data/{cfg["list_id"]}"></form>'
            f'<select name="gender"><option selected value="{gender}"></option></select>'
            '<div class="custom-table-title"><h3>Men\'s 400 Meters (Final)</h3></div>'
            '<div class="performance-list">' + row * count + '</div>')


def response(body=None, failure=None):
    result = Mock(text=body if body is not None else html())
    result.raise_for_status.side_effect = failure
    return result


def files_in(directory):
    return {str(p.relative_to(directory)): p.read_bytes() for p in directory.rglob('*') if p.is_file()}


def session_for(configs=(CFG,), performance="45.00"):
    session = Mock()

    def get(url, **kwargs):
        parsed = urlparse(url)
        cfg = next(c for c in configs if c['list_id'] == parsed.path.split('/')[2])
        gender = parse_qs(parsed.query)['gender'][0]
        return response(html(performance, cfg=cfg, gender=gender))

    session.get.side_effect = get
    return session


class DataTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name) / "data"
        self.data.mkdir()
        self.seed = [record(), record(gender="f"), record("2025-2026 (2026-10-01)")]
        publish(self.seed, CONFIG, self.data)

    def scrape(self, **kwargs):
        session = kwargs.pop("session", None)
        if session is None:
            session = session_for(CONFIG[kwargs.get('mode', 'active')])
        return run_scrape(data_dir=self.data, config=CONFIG, session=session,
                          sleeper=lambda _: None, **kwargs)

    def test_consecutive_days_preserve_snapshots_and_latest_standings(self):
        self.scrape(today="2026-10-02")
        session = session_for(performance="44.50")
        self.scrape(today="2026-10-03", session=session)
        dates = json.loads((self.data / "dates.json").read_text())
        self.assertEqual(dates, ["2026-10-01", "2026-10-02", "2026-10-03"])
        active = json.loads((self.data / "tfrrs_active_data.json").read_text())
        self.assertEqual({r['rankings'][0]['time'] for r in active}, {"44.50"})
        historical = json.loads((self.data / "historical_indoor_m_400_Meters.json").read_text())
        self.assertIn("2025-2026 (2026-10-02)", {r['year'] for r in historical})

    def test_same_day_rerun_replaces_without_duplicates_and_noop_is_stable(self):
        self.scrape(today="2026-10-02")
        session = session_for(performance="44.50")
        records = self.scrape(today="2026-10-02", session=session)
        self.assertEqual(len(records), len({record_key(r) for r in records}))
        before = files_in(self.data)
        self.scrape(today="2026-10-02", session=session)
        self.assertEqual(before, files_in(self.data))
        self.assertEqual(publish(load_records(self.data / MASTER), CONFIG, self.data), 0)

    def test_retries_timeout_and_success(self):
        session = Mock()
        session.get.side_effect = [requests.Timeout(), requests.ConnectionError(), response(), response(html(gender='f'))]
        collected = collect([CFG], session=session, sleeper=lambda _: None)
        self.assertEqual(len(collected), 2)
        self.assertEqual(session.get.call_count, 4)
        self.assertEqual(session.get.call_args.kwargs['timeout'], (10, 45))

    def test_failed_second_page_never_publishes_partial_results(self):
        before = files_in(self.data)
        session = Mock()
        session.get.side_effect = [response()] + [response(failure=requests.HTTPError("503"))] * 3
        with self.assertRaises(requests.HTTPError):
            self.scrape(today="2026-10-02", session=session)
        self.assertEqual(before, files_in(self.data))
        self.assertEqual(session.get.call_count, 4)

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

    def test_corrupt_and_missing_master_fail_before_network_requests(self):
        session = Mock()
        (self.data / MASTER).write_text('{broken')
        before = files_in(self.data)
        with self.assertRaises(ValueError):
            self.scrape(session=session)
        self.assertEqual(before, files_in(self.data))
        (self.data / MASTER).unlink()
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
                publish(merge_records(self.seed, [record("2025-2026 (2026-10-02)")]), CONFIG, self.data)
        self.assertEqual(before, files_in(self.data))

    def test_historical_backfill_adds_no_artificial_dates(self):
        self.scrape(mode="historical")
        self.assertEqual(json.loads((self.data / "dates.json").read_text()), ["2026-10-01"])
        self.assertIn("2024-2025", {r['year'] for r in load_records(self.data / MASTER)})

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
        files = derive_files([record(), record('2026-2027')], config)
        self.assertEqual([r['year'] for r in files['tfrrs_active_data.json']], ['2026-2027'])

    def test_cutoff_rules_and_small_roster_fallback_are_unchanged(self):
        for event, season, region, expected in [
            ('400 Meters', 'indoor', 'National', 16),
            ('4x400 Relay', 'indoor', 'National', 12),
            ('Distance Medley Relay', 'indoor', 'National', 12),
            ('400 Meters', 'outdoor', 'East', 48),
            ('4x400 Relay', 'outdoor', 'West', 24),
            ('Decathlon', 'outdoor', 'National', 24),
        ]:
            self.assertEqual(get_cutoff_rank(event, season, region), expected)
        self.assertEqual(derive_files([record()], CONFIG)['tfrrs_bubble_cutoffs.json'][0]['cutoff_rank'], 1)

    def test_legacy_records_can_omit_team_and_normalize_year_for_dedup(self):
        old = record('2025_2026')
        del old['rankings'][0]['team']
        self.assertEqual(derive_files([old], CONFIG)['tfrrs_bubble_cutoffs.json'][0]['cutoff_team'], 'N/A')
        self.assertEqual(len(merge_records([old], [record()])), 1)

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

    def test_filename_collisions_fail_before_writes(self):
        other = dict(record(), event='400-Meters')
        with self.assertRaises(ValueError):
            derive_files([record(), other], CONFIG)

    def test_validation_detects_stale_derived_files_without_rewriting_them(self):
        validate_data(self.data, CONFIG)
        path = self.data / 'dates.json'
        path.write_text('["2026-10-09"]')
        before = files_in(self.data)
        with self.assertRaisesRegex(ValueError, 'Stale derived data'):
            validate_data(self.data, CONFIG)
        self.assertEqual(before, files_in(self.data))

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


class RecoveryTests(unittest.TestCase):
    def test_recovers_actual_snapshots_with_latest_record_winning(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)

            def git(*args):
                return subprocess.check_output(['git', '-C', tmp, *args], text=True, stderr=subprocess.DEVNULL)

            def commit(message):
                git('add', '.')
                git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', message)

            git('init')
            root = repo / 'data' / MASTER
            public = repo / 'ncaa-qualification/public/data' / MASTER
            root.parent.mkdir()
            public.parent.mkdir(parents=True)
            public.write_text(json.dumps([record(), record('2025-2026 (2026-10-01)')]))
            root.write_text(public.read_text())
            commit('first snapshot')
            root.write_text(json.dumps([record(), record('2025-2026 (2026-10-02)')]))
            commit('lost prior day')
            latest = record('2025-2026 (2026-10-01)', performance='44.00')
            root.write_text(json.dumps([record(), latest]))
            commit('correct first day')
            # Later daily runs lose that snapshot again. An unchanged stale
            # frontend copy must not overwrite the corrected historical value.
            root.write_text(json.dumps([record(), record('2025-2026 (2026-10-02)')]))
            commit('lost corrected day')
            # A stale date manifest must never create a fictional snapshot.
            (root.parent / 'dates.json').write_text('["2026-10-09"]')
            before = files_in(root.parent)
            recovered = recover_records(repo, 'HEAD')
            files = derive_files(recovered, CONFIG)
            self.assertEqual(files['dates.json'], ['2026-10-01', '2026-10-02'])
            self.assertEqual(next(r for r in recovered if r['year'] == latest['year']), latest)
            self.assertEqual(before, files_in(root.parent))
            self.assertEqual(len(recovered), len({record_key(r) for r in recovered}))


if __name__ == '__main__':
    unittest.main()
