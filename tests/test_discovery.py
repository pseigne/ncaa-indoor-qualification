import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import requests

from tfrrs_data import collect, load_championships, load_config, load_records, publish, run_scrape
from tfrrs_lists import (candidates_from_page, discover_config, list_identity,
                         verify_page_identity)
from test_data import files_in, html, record, response, session_for


def season_config():
    # Keep rollover scenarios fixed even after the real configuration advances.
    active = [dict(year='2026', season='outdoor', region=region, list_id=list_id, list_name='Outdoor_List')
              for region, list_id in [('East', '5622'), ('West', '5623'), ('National', '5602')]]
    active.append(dict(year='2025-2026', season='indoor', region='National',
                       list_id='5352', list_name='Indoor_List'))
    return dict(active=active, historical=copy.deepcopy(active),
                discovery=dict(enabled=True, sources=['https://tf.tfrrs.org/']))


def newer_config(config):
    result = copy.deepcopy(config)
    for cfg in result['active']:
        cfg['year'] = '2026-2027' if cfg['season'] == 'indoor' else '2027'
        cfg['list_id'] = str(int(cfg['list_id']) + 1000)
        cfg['list_name'] = 'New_List'
    return result


def navigation(config, homepage=False):
    nodes = []
    for cfg in config['active']:
        title = (f"{cfg['year']} NCAA Div. I " +
                 (f"{cfg['region']} " if cfg['region'] != 'National' else '') +
                 f"{cfg['season'].title()} List")
        slug = title.replace('-', '_').replace('.', '').replace(' ', '_')
        url = f"https://tf.tfrrs.org/lists/{cfg['list_id']}/{slug}"
        nodes.append(f'<a href="{url}">NCAA DIV. I</a>' if homepage else
                     f'<option value="{url}">{title}</option>')
    return ''.join(nodes) if homepage else '<select name="other_lists">' + ''.join(nodes) + '</select>'


class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.config = season_config()
        self.new = newer_config(self.config)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name) / 'data'
        self.path = Path(self.tmp.name) / 'scrape_config.json'
        self.path.write_text(json.dumps(self.config))
        self.seed = [record(), record('2025-2026 (2026-10-01)')]
        publish(self.seed, {('indoor', '2025-2026'): ['2026-10-01']}, self.config, self.data, championships={})

    def session(self, nav=None, invalid_new=False, invalid_old=False):
        configs = self.config['active'] + self.new['active']
        session = session_for(configs)
        rankings_get = session.get.side_effect

        def get(url, **kwargs):
            if url == self.config['discovery']['sources'][0]:
                return response(nav if nav is not None else navigation(self.new))
            if invalid_old or (invalid_new and any(f"/lists/{c['list_id']}/" in url for c in self.new['active'])):
                return response('Access denied')
            return rankings_get(url, **kwargs)

        session.get.side_effect = get
        return session

    def run_scrape(self, session):
        return run_scrape(data_dir=self.data, config_path=self.path, session=session,
                          discover=True, today='2026-10-18', sleeper=lambda _: None, championships={})

    def test_matches_real_title_variations_but_excludes_wrong_divisions_and_regions(self):
        for title, year, season, region in [
            ('2025-2026 NCAA Division I Indoor List (FINAL)', '2025-2026', 'indoor', 'National'),
            ('2024-2025 NCAA Division I Indoor Qualifying', '2024-2025', 'indoor', 'National'),
            ('2026 NCAA Div. I East Outdoor List (FINAL)', '2026', 'outdoor', 'East'),
            ('2025 NCAA Div. I West Outdoor List', '2025', 'outdoor', 'West'),
            ('2024 NCAA Division I Rankings (FINAL)', '2024', 'outdoor', 'National'),
            ('2023 NCAA Division I (All Schools) Rankings', '2023', 'outdoor', 'National'),
            ('2023_NCAA_Division_I_All_Schools_Rankings', '2023', 'outdoor', 'National'),
            ('2010_2011_NCAA_Division_I_East_POP_List_FINAL', '2011', 'outdoor', 'East'),
            ('2010_2011_NCAA_Division_I_West_POP_List_FINAL', '2011', 'outdoor', 'West'),
            ('2012_NCAA_Div_I_East_Qualifiers_Final', '2012', 'outdoor', 'East'),
            ('2012_NCAA_Div_I_West_Qualifiers_Final', '2012', 'outdoor', 'West'),
            ('2009-2010 NCAA Div. I Indoor POP List (FINAL)', '2009-2010', 'indoor', 'National'),
            ('2011-2012 NCAA Div. I Indoor Qualifiers (FINAL)', '2011-2012', 'indoor', 'National'),
            ('2025_2026_NCAA_Division_I_Indoor_List_FINAL', '2025-2026', 'indoor', 'National'),
            ('2026_NCAA_Div_I_East_Outdoor_List_FINAL', '2026', 'outdoor', 'East'),
        ]:
            self.assertEqual(list_identity(title), dict(year=year, season=season, region=region))
        for title in ['2026 NCAA Division II Outdoor List', '2026 NCAA Division III Outdoor List',
                      'DI Great Lakes Region Outdoor Performance List', '2026 NAIA Outdoor List',
                      '2025-2027 NCAA Division I Indoor List', '2027 NCAA Division I Indoor List',
                      '2026 NCAA Division I Northeast Outdoor List']:
            self.assertIsNone(list_identity(title))

    def test_reads_dropdown_and_homepage_links_without_guessing_ids(self):
        for homepage in (True, False):
            candidates = candidates_from_page(navigation(self.new, homepage), 'https://tf.tfrrs.org/')
            self.assertEqual({c['list_id'] for c in candidates}, {c['list_id'] for c in self.new['active']})
        for page in ['Access denied', navigation(self.new).replace('https://tf.tfrrs.org', 'https://example.com')]:
            with self.assertRaises(ValueError):
                candidates_from_page(page, 'https://tf.tfrrs.org/')

    def test_selects_latest_complete_seasons_and_preserves_history(self):
        config = discover_config(self.config, self.session(navigation(self.config) + navigation(self.new)),
                                 sleeper=lambda _: None, current_year=2026)
        self.assertEqual({c['year'] for c in config['active']}, {'2026-2027', '2027'})
        for old in self.config['active']:
            self.assertIn(old, config['historical'])
        self.assertEqual(self.config, load_config(self.path))

    def test_discovery_selects_verified_2024_2025_and_2026_ids(self):
        # These labels and IDs were checked against the live season selectors.
        seasons = {
            2024: ('4573', '4574', '4515', '4364'),
            2025: ('5052', '5053', '5018', '4867'),
            2026: ('5622', '5623', '5602', '5352'),
        }
        pages = []
        for year, ids in seasons.items():
            cfg = season_config()
            for item, list_id in zip(cfg['active'], ids):
                item.update(year=f'{year-1}-{year}' if item['season'] == 'indoor' else str(year),
                            list_id=list_id)
            pages.append(navigation(cfg))
        baseline = season_config()
        for item in baseline['active']:
            item['year'] = '2022-2023' if item['season'] == 'indoor' else '2023'
        for year, ids in seasons.items():
            result = discover_config(baseline, self.session(''.join(pages)),
                                     sleeper=lambda _: None, current_year=year - 1)
            self.assertEqual(tuple(c['list_id'] for c in result['active']), ids)

    def test_outdoor_waits_for_all_three_lists_and_indoor_can_roll_independently(self):
        partial = copy.deepcopy(self.new)
        partial['active'] = [c for c in partial['active'] if c['region'] != 'West']
        config = discover_config(self.config, self.session(navigation(self.config) + navigation(partial)),
                                 sleeper=lambda _: None, current_year=2026)
        self.assertEqual({c['year'] for c in config['active'] if c['season'] == 'outdoor'}, {'2026'})
        self.assertEqual(config['active'][-1]['year'], '2026-2027')

    def test_never_downgrades_or_promotes_distant_future(self):
        old = copy.deepcopy(self.config)
        future = copy.deepcopy(self.new)
        for item in old['active']:
            item['year'] = '2024-2025' if item['season'] == 'indoor' else '2025'
        for item in future['active']:
            item['year'] = '2098-2099' if item['season'] == 'indoor' else '2099'
        config = discover_config(self.config, self.session(navigation(old) + navigation(future)),
                                 sleeper=lambda _: None, current_year=2026)
        self.assertEqual(config, self.config)

    def test_conflicting_ids_are_ambiguous_and_config_is_retained(self):
        conflict = copy.deepcopy(self.new)
        conflict['active'][0]['list_id'] = '99999'
        session = self.session(navigation(self.new) + navigation(conflict))
        self.run_scrape(session)
        self.assertEqual(load_config(self.path), self.config)

    def test_validated_rollover_saves_config_and_data_together(self):
        records = self.run_scrape(self.session())
        config = load_config(self.path)
        self.assertEqual({c['year'] for c in config['active']}, {'2026-2027', '2027'})
        self.assertIn(self.seed[1], records)
        self.assertIn('2026-2027 (2026-10-18)', {r['year'] for r in records})
        index = json.loads((self.data / 'site/index.json').read_text())
        current = [e for e in index['lists'] if e['current']]
        # Indoor, and outdoor East and West, for both genders: the national outdoor list isn't shown.
        self.assertEqual(len(current), 6)
        self.assertEqual({e['year'] for e in current}, {'2026-2027', '2027'})
        before = files_in(Path(self.tmp.name))
        self.run_scrape(self.session())
        self.assertEqual(before, files_in(Path(self.tmp.name)))

    def test_finished_seasons_still_look_for_the_next_one(self):
        # Mid-October: both saved seasons are finished and TFRRS has nothing newer, so only the
        # navigation is read and nothing changes.
        current = discover_config(self.config, self.session(navigation(self.config)),
                                  sleeper=lambda _: None, current_year=2026)
        self.path.write_text(json.dumps(current))
        before = (files_in(self.data / 'archive'), self.path.read_text())
        session = self.session(navigation(self.config))
        run_scrape(data_dir=self.data, config_path=self.path, session=session, discover=True,
                   today='2026-10-18', sleeper=lambda _: None, championships=load_championships())
        self.assertEqual(session.get.call_count, 1)
        self.assertEqual(before, (files_in(self.data / 'archive'), self.path.read_text()))

    def test_a_finished_list_that_discovery_renames_is_checked_before_saving(self):
        session = self.session(navigation(self.config))
        run_scrape(data_dir=self.data, config_path=self.path, session=session, discover=True,
                   today='2026-10-18', sleeper=lambda _: None, championships=load_championships())
        # The navigation names the same IDs with new slugs: all eight pages are read first.
        self.assertEqual(session.get.call_count, 9)
        self.assertEqual({c['list_name'] for c in load_config(self.path)['active']},
                         {'2026_NCAA_Div_I_East_Outdoor_List', '2026_NCAA_Div_I_West_Outdoor_List',
                          '2026_NCAA_Div_I_Outdoor_List', '2025_2026_NCAA_Div_I_Indoor_List'})

    def test_new_seasons_found_after_finished_ones_are_collected(self):
        session = self.session()
        run_scrape(data_dir=self.data, config_path=self.path, session=session, discover=True,
                   today='2026-12-15', sleeper=lambda _: None, championships=load_championships())
        config = load_config(self.path)
        self.assertEqual({c['year'] for c in config['active']}, {'2026-2027', '2027'})
        # Navigation, then the eight new pages; the finished seasons aren't asked for again.
        self.assertEqual(session.get.call_count, 9)
        records = load_records(self.data)
        self.assertIn('2026-2027 (2026-12-15)', {r['year'] for r in records})
        index = json.loads((self.data / 'site/index.json').read_text())
        self.assertEqual({(e['year'], e['current']) for e in index['lists'] if e['season'] == 'indoor'},
                         {('2026-2027', True), ('2025-2026', False)})

    def test_empty_or_malformed_new_lists_fall_back_without_saving_new_config(self):
        for body in ['Access denied', html(count=0, cfg=self.new['active'][0])]:
            session = self.session(invalid_new=True)
            get = session.get.side_effect
            session.get.side_effect = lambda url, **kw: response(body) if '/lists/6622/' in url else get(url, **kw)
            self.run_scrape(session)
            self.assertEqual(load_config(self.path), self.config)
            self.assertNotIn('2027', {r['year'] for r in load_records(self.data)})

    def test_discovery_http_failure_retries_then_uses_existing_lists(self):
        session = self.session()
        get = session.get.side_effect

        def fail_discovery(url, **kwargs):
            if url == self.config['discovery']['sources'][0]:
                raise requests.Timeout('discovery unavailable')
            return get(url, **kwargs)

        session.get.side_effect = fail_discovery
        self.run_scrape(session)
        self.assertEqual(session.get.call_count, 11)
        self.assertEqual(load_config(self.path), self.config)

    def test_last_new_gender_page_must_validate_before_rollover(self):
        session = self.session()
        get = session.get.side_effect

        def fail_last(url, **kwargs):
            if '/lists/6352/' in url and url.endswith('gender=f'):
                return response(html(count=0, cfg=self.new['active'][-1], gender='f'))
            return get(url, **kwargs)

        session.get.side_effect = fail_last
        self.run_scrape(session)
        self.assertEqual(load_config(self.path), self.config)
        self.assertEqual(session.get.call_count, 17)  # navigation, eight new, eight fallback

    def test_malformed_navigation_retains_configuration(self):
        self.run_scrape(self.session('<html>Navigation changed</html>'))
        self.assertEqual(load_config(self.path), self.config)

    def test_failures_in_both_new_and_existing_lists_preserve_all_files(self):
        before = files_in(Path(self.tmp.name))
        with self.assertRaises(ValueError):
            self.run_scrape(self.session(invalid_new=True, invalid_old=True))
        self.assertEqual(before, files_in(Path(self.tmp.name)))

    def test_generation_and_config_replacement_failures_rollback_both(self):
        before = files_in(Path(self.tmp.name))
        with patch('tfrrs_data.derive_files', side_effect=ValueError('generation failed')):
            with self.assertRaises(ValueError):
                self.run_scrape(self.session())
        self.assertEqual(before, files_in(Path(self.tmp.name)))
        import os
        replace = os.replace

        def fail_config(source, target):
            if Path(target) == self.path:
                raise OSError('cannot save config')
            replace(source, target)

        with patch('tfrrs_data.os.replace', side_effect=fail_config):
            with self.assertRaises(OSError):
                self.run_scrape(self.session())
        self.assertEqual(before, files_in(Path(self.tmp.name)))

    def test_title_list_id_and_gender_must_match_before_collecting(self):
        cfg = self.config['active'][0]
        body = html(cfg=cfg)
        verify_page_identity(body, cfg, 'm')
        for invalid in [body.replace('East Outdoor', 'West Outdoor'),
                        body.replace('/list_data/5622', '/list_data/999'),
                        body.replace('selected value="m"', 'selected value="f"'),
                        body.replace('2026 NCAA', '2025 NCAA')]:
            session = self.session()
            session.get.side_effect = None
            session.get.return_value = response(invalid)
            with self.assertRaises(ValueError):
                collect([cfg], session=session, sleeper=lambda _: None)

    def test_disabled_discovery_does_not_fetch_navigation(self):
        config = copy.deepcopy(self.config)
        config['discovery']['enabled'] = False
        self.path.write_text(json.dumps(config))
        session = session_for(config['active'])
        self.run_scrape(session)
        self.assertEqual(session.get.call_count, 8)


if __name__ == '__main__':
    unittest.main()
