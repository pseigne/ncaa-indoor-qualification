import copy
import unittest

from qualification import interpret_qualification
from tfrrs_data import derive_files, load_records


def event_record(event='4 x 400 Relay', season='indoor', region='National',
                 gender='m', ranks=range(1, 61), year='2025-2026'):
    return dict(year=year, season=season, region=region, gender=gender, event=event,
                rankings=[dict(rank=rank, athlete=f'Runner {rank}', team=f'School {rank}',
                               time=f'3:{rank:02d}.27@') for rank in ranks])


class QualificationTests(unittest.TestCase):
    def test_rule_matrix_and_real_relay_spellings(self):
        for gender in ('m', 'f'):
            for season, regions in [('indoor', ('National',)),
                                    ('outdoor', ('East', 'West', 'National', 'Unified'))]:
                for region in regions:
                    for event in ('4x400', '4 x 400 Relay', '4 X 100 RELAY',
                                  '4×400', 'Distance Medley Relay', 'distance medley'):
                        with self.subTest(gender=gender, season=season, region=region, event=event):
                            result = interpret_qualification(event_record(event, season, region, gender))
                            self.assertEqual(result['rank'], 12 if season == 'indoor' else 24)
                            self.assertTrue(result['is_relay'])
                            self.assertEqual(result['entry']['rank'], result['rank'])
                            self.assertEqual(result['status'], 'available')
                    result = interpret_qualification(event_record('400 Meters', season, region, gender))
                    self.assertEqual(result['rank'], 16 if season == 'indoor' else 24 if region == 'National' else 48)
                    self.assertFalse(result['is_relay'])
                    for event in ('Decathlon', 'Heptathlon'):
                        result = interpret_qualification(event_record(event, season, region, gender))
                        self.assertEqual(result['rank'], 16 if season == 'indoor' else 24)

    def test_short_and_incomplete_rosters_do_not_promote_other_ranks(self):
        for ranks in ([1, 2], [r for r in range(1, 61) if r != 12]):
            result = interpret_qualification(event_record(ranks=ranks))
            self.assertEqual(result, dict(rank=12, is_relay=True, status='missing_rank', entry=None))

    def test_exact_rank_and_source_values_survive_unsorted_input(self):
        record = event_record(ranks=[20, 12, 1])
        before = copy.deepcopy(record)
        result = interpret_qualification(record)
        self.assertEqual(result['entry'], record['rankings'][1])
        self.assertEqual(result['entry']['time'], '3:12.27@')
        self.assertEqual(record, before)

    def test_published_lists_share_metadata_without_changing_the_archive(self):
        for ranks in ([1, 12, 20], [1, 20]):
            record = event_record(ranks=ranks)
            snapshot = dict(record, year=f"{record['year']} (2026-01-02)")
            before = copy.deepcopy(record)
            config = {'active': [dict(year=record['year'], season='indoor', region='National',
                                      list_id='1', list_name='List')]}
            files = derive_files([record, snapshot], {('indoor', '2025-2026'): ['2026-01-02']}, config, {})
            event = files['site/indoor-2025-2026-m-National.json']['events'][0]
            expected = interpret_qualification(record)
            self.assertEqual(event['qualification'], expected)
            self.assertEqual(event['rankings'], before['rankings'])
            self.assertEqual(event['series'], [['2026-01-02', expected['entry']['time'] if expected['entry'] else None, 3 if 12 in ranks else 2]])
            archived = files['archive/indoor/2025-2026.json']['lists']
            self.assertEqual([entry['rankings'] for entry in archived], [before['rankings'], before['rankings']])
            self.assertEqual(record, before)

if __name__ == '__main__':
    unittest.main()
