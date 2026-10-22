"""Generate browser-test inputs through the production data projection."""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tfrrs_data import derive_files


def project(event='4 x 400 Relay', season='indoor', region='National', gender='m',
            ranks=range(1, 17), year='2025-2026', performance='3:12.27@'):
    record = dict(year=year, event=event, season=season, region=region, gender=gender,
                  rankings=[dict(rank=r, athlete=f'Runner {r}', team=f'School {r}',
                                 time=performance if r in (12, 16, 24, 48) else '3:00.00') for r in ranks])
    files = derive_files([record], {'active': [dict(year=year, season=season, region=region)]})
    return dict(record=files['tfrrs_active_data.json'][0], summary=files['tfrrs_bubble_cutoffs.json'][0])


def fixtures():
    return dict(
        relay=project(),
        outdoor=project(season='outdoor', region='East', ranks=range(1, 50), year='2026'),
        individual=project(event='400 Meters', gender='f', ranks=range(1, 20), performance='45.27#'),
        short=project(ranks=[1, 2]),
        missing=project(ranks=[r for r in range(1, 17) if r != 12]),
        unsorted=project(ranks=[16, 12, 1]),
        old=project(year='2023-2024'),
        old_missing=project(ranks=[1, 2], year='2024-2025'))


if __name__ == '__main__':
    print(json.dumps(fixtures()))
