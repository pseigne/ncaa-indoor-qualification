import copy
import unittest

from qualification import interpret_qualification
from tfrrs_data import MASTER, derive_files


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

    def test_all_generated_views_share_metadata_without_changing_master(self):
        for ranks in ([1, 12, 20], [1, 20]):
            record = event_record(ranks=ranks)
            before = copy.deepcopy(record)
            config = {'active': [dict(year=record['year'], season='indoor', region='National')]}
            files = derive_files([record], config)
            summary = files['tfrrs_bubble_cutoffs.json'][0]
            active = files['tfrrs_active_data.json'][0]
            historical = files['historical_indoor_m_4_x_400_Relay.json'][0]
            expected = interpret_qualification(record)
            for output in (summary, active, historical):
                self.assertEqual(output['qualification'], expected)
            self.assertEqual(active['rankings'], before['rankings'])
            self.assertEqual(historical['rankings'], before['rankings'])
            self.assertEqual(summary['cutoff_rank'], 12)
            for key, source in [('cutoff_time', 'time'), ('cutoff_athlete', 'athlete'), ('cutoff_team', 'team')]:
                self.assertEqual(summary[key], expected['entry'][source] if expected['entry'] else None)
            self.assertEqual(files[MASTER], [before])
            self.assertEqual(record, before)


if __name__ == '__main__':
    unittest.main()
