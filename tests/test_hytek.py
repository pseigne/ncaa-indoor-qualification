from pathlib import Path
import unittest

from hytek import EVENT_NAMES, event_name, parse_performance_list, parse_seed

FIXTURES = Path(__file__).resolve().parent / 'fixtures' / 'hytek'


def fixture(name):
    return (FIXTURES / name).read_bytes()


def entries(page, event):
    return next(e for e in page['events'] if e['event'] == event)['entries']


class PerformanceListTests(unittest.TestCase):
    def test_reads_an_indoor_accepted_list_with_declared_seeds(self):
        page = parse_performance_list(fixture('indoor_accepted_2026.htm'))
        self.assertEqual((page['kind'], page['region'], page['generated']), ('accepted', 'National', '2026-03-03T16:18'))
        self.assertEqual(page['meet'], 'NCAA Division I 2026 Indoor Championship Example Indoor Track Center')
        self.assertEqual([e['event'] for e in page['events']],
                         ['60 Meters', 'Mile', '4 x 400 Relay', 'High Jump', 'Pentathlon'])
        self.assertEqual(entries(page, '60 Meters')[0], {'rank': 1, 'name': 'Mara Quill', 'class': 'SR',
                                                          'school': 'Ole Miss', 'seed': '7.08', 'status': 'D'})
        mile = entries(page, 'Mile')
        self.assertEqual((mile[1]['name'], mile[1]['class'], mile[1]['school'], mile[1]['seed']),
                         ('Annaliese Featherstonehaughs', 'GR', 'N. Carolina A&T', '4:29.95'))
        self.assertEqual([(e['school'], e['seed']) for e in entries(page, 'High Jump')],
                         [('TX Tech', '1.97'), ('West Virgini', '1.91')])
        self.assertEqual(entries(page, 'Pentathlon')[1]['seed'], '4401')
        self.assertTrue(all(e['gender'] == 'f' for e in page['events']))

    def test_relays_skip_runner_lines_and_use_the_school_as_the_name(self):
        page = parse_performance_list(fixture('indoor_accepted_2026.htm'))
        relay = next(e for e in page['events'] if e['relay'])
        self.assertEqual(relay['entries'], [
            {'rank': 1, 'name': 'Arkansas', 'class': None, 'school': 'Arkansas', 'seed': '3:25.82', 'status': 'D'},
            {'rank': 2, 'name': 'TX A&M', 'class': None, 'school': 'TX A&M', 'seed': '3:27.01', 'status': 'D'}])

    def test_reads_bib_columns_counts_and_a_revised_stamp(self):
        page = parse_performance_list(fixture('indoor_accepted_2015.htm'))
        self.assertEqual((page['kind'], page['generated']), ('accepted', '2015-03-10T21:17'))
        self.assertEqual([e['event'] for e in page['events']],
                         ['60 Meters', '4 x 400 Relay', 'Distance Medley Relay', 'High Jump'])
        self.assertEqual([(e['name'], e['school'], e['seed']) for e in entries(page, '60 Meters')],
                         [('Rafe Dunmore', 'TCU', '6.51'), ('Cole Ashby', 'Okla State', '6.54')])
        self.assertEqual(entries(page, 'High Jump')[0]['seed'], '2.29')
        self.assertEqual(entries(page, '4 x 400 Relay')[0]['school'], 'Florida')

    def test_reads_short_headings_and_lines_broken_by_hand(self):
        page = parse_performance_list(fixture('indoor_accepted_2018.htm'))
        self.assertEqual([e['event'] for e in page['events']],
                         ['Mile', '60 Hurdles', 'Distance Medley Relay', 'Weight Throw'])
        self.assertEqual([(e['rank'], e['name'], e['school'], e['seed']) for e in entries(page, '60 Hurdles')],
                         [(1, 'Al Brook', 'Florida', '7.51'), (2, 'Cy Dane', 'Houston', '7.60')])
        self.assertEqual(entries(page, 'Weight Throw')[0]['seed'], '23.81')

    def test_regions_come_from_the_page_header(self):
        east = parse_performance_list(fixture('outdoor_east_2026.htm'))
        self.assertEqual((east['kind'], east['region']), ('accepted', 'East'))
        self.assertEqual([e['event'] for e in east['events']],
                         ['100 Meters', '3000 Steeplechase', '10,000 Meters', '4 x 100 Relay', 'Javelin'])
        self.assertEqual(entries(east, '100 Meters')[1], {'rank': 2, 'name': 'Shea Walker', 'class': 'SR',
                                                          'school': 'Florida State', 'seed': '10.80', 'status': None})
        self.assertEqual(entries(east, '4 x 100 Relay')[0]['seed'], '42.31')
        # "West" in a venue line does not make a page regional; "-West Preliminary" does.
        west = parse_performance_list(fixture('outdoor_west_2019.htm'))
        self.assertEqual((west['kind'], west['region'], west['generated']), ('accepted', 'West', None))
        self.assertEqual([e['event'] for e in west['events']], ['110 Hurdles', '4 x 100 Relay', 'Hammer'])

    def test_national_outdoor_lists_are_qualifiers_or_multis(self):
        qualifiers = parse_performance_list(fixture('outdoor_qualifiers_2026.htm'))
        self.assertEqual((qualifiers['kind'], qualifiers['region']), ('qualifiers', 'National'))
        self.assertEqual([e['event'] for e in qualifiers['events']], ['100 Meters', 'Heptathlon'])
        multi = parse_performance_list(fixture('outdoor_decathlon_2016.htm'))
        self.assertEqual((multi['kind'], multi['region']), ('multi', 'National'))
        # The full list marks who declared (D), was considered (A) or scratched (S).
        self.assertEqual([(e['name'], e['seed'], e['status']) for e in entries(multi, 'Decathlon')],
                         [('Lindon Vale', '8446', 'D'), ('Luca Wied', '7784', 'S'),
                          ('Ibn Short', '7588', 'A'), ('Ezra Hale', '7400', None)])

    def test_review_pages_are_other(self):
        page = parse_performance_list(fixture('indoor_review_2026.htm'))
        self.assertEqual((page['kind'], page['generated']), ('other', '2026-03-03'))
        self.assertEqual([e['status'] for e in entries(page, '60 Meters')], ['A', 'S', None])

    def test_reads_utf8_and_windows_1252_pages(self):
        text = fixture('indoor_accepted_2026.htm').decode('cp1252').replace('Mara Quill', 'Zoë Närhi  ')
        for body in (text.encode('utf-8'), text.encode('cp1252')):
            page = parse_performance_list(body)
            self.assertEqual(entries(page, '60 Meters')[0]['name'], 'Zoë Närhi')

    def test_columns_padded_by_bytes_on_utf8_pages(self):
        # The 2021 First Round lists counted "ñ" as two characters when padding the columns.
        text = fixture('indoor_accepted_2026.htm').decode('cp1252')
        text = text.replace('  1  Mara Quill                    SR Ole Miss  ', '  1  Jose Peñalver                SR Ole Miss  ')
        page = parse_performance_list(text.encode('utf-8'))
        self.assertEqual(entries(page, '60 Meters')[0], {'rank': 1, 'name': 'Jose Peñalver', 'class': 'SR',
                                                          'school': 'Ole Miss', 'seed': '7.08', 'status': 'D'})
        self.assertEqual(entries(page, '60 Meters')[1]['name'], 'Tess Varden')

    def test_fails_loudly_on_anything_unrecognized(self):
        good = fixture('indoor_accepted_2026.htm').decode('cp1252')
        broken = {
            'unknown event': good.replace('Women High Jump', 'Women Standing Jump'),
            'unknown seed': good.replace('7.08D', '7.08Q', 1),
            'not division I': good.replace('NCAA Division I 2026', 'NCAA Division II 2026'),
            'not a performance list': good.replace('Performance List', 'Results'),
            'no listing': '<html><body><p>Nothing here</p></body></html>',
            'unreadable row': good.replace('  3  Ines Joseph', '  3x Ines Joseph'),
            'unknown region': fixture('outdoor_east_2026.htm').decode('cp1252').replace(
                '-East First Rounds', '-East Super Regional'),
        }
        for label, html in broken.items():
            with self.subTest(label), self.assertRaises(ValueError):
                parse_performance_list(html)

    def test_event_names_are_archive_names(self):
        self.assertEqual(event_name('60 Meter Dash (16) Prelims'), '60 Meters')
        self.assertEqual(event_name('1 Mile Run Prelims'), 'Mile')
        self.assertEqual(event_name('4x400 Meter Relay (24) Prelims'), '4 x 400 Relay')
        self.assertEqual(event_name('3000 Meter Steeplechase Prelims'), '3000 Steeplechase')
        self.assertEqual(event_name('10000 Meter Run'), '10,000 Meters')
        self.assertEqual(event_name('Discus Throw Finals'), 'Discus')
        names = set(EVENT_NAMES.values())
        catalog = (Path(__file__).resolve().parents[1] / 'ncaa-qualification/src/utils/catalog.js').read_text()
        for name in names:
            self.assertIn(f"['{name}',", catalog)

    def test_seed_suffixes_are_stripped(self):
        self.assertEqual(parse_seed('7.08D'), ('7.08', 'D'))
        self.assertEqual(parse_seed('1.97mD'), ('1.97', 'D'))
        self.assertEqual(parse_seed('6.71m'), ('6.71', None))
        self.assertEqual(parse_seed('1:58.81S'), ('1:58.81', 'S'))
        self.assertEqual(parse_seed('6093'), ('6093', None))
        with self.assertRaises(ValueError):
            parse_seed('NT')


if __name__ == '__main__':
    unittest.main()
