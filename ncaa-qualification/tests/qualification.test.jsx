import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import EventsList from '../src/components/EventsList';
import EventCard from '../src/components/EventCard';
import Monitor from '../src/components/Monitor';
import Archive from '../src/components/Archive';

const chart = vi.hoisted(() => ({ configs: [] }));
vi.mock('chart.js', () => ({
  registerables: [],
  Chart: class {
    static register() {}
    constructor(_context, config) { chart.configs.push(config); }
    destroy() {}
  },
}));

const fixturePath = resolve(process.cwd(), '../tests/qualification_fixtures.py');
const fixtures = JSON.parse(execFileSync('python3', [fixturePath], { encoding: 'utf8' }));

function serve(active, summaries, historical = []) {
  vi.stubGlobal('fetch', vi.fn(async url => ({
    ok: true,
    json: async () => url.includes('tfrrs_active_data') ? active
      : url.includes('tfrrs_bubble_cutoffs') ? summaries : historical,
  })));
}

function summary(record) {
  return render(<EventsList loading={false} filteredEvents={[record]} selectedEvent="all" />);
}

function snapshot(source, date) {
  return { ...source, year: `${source.year} (${date})` };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  chart.configs.length = 0;
});

describe('Python-generated qualification in current rankings', () => {
  it.each(['relay', 'outdoor', 'individual', 'unsorted'])('uses the exact generated entry for %s', name => {
    const { record } = fixtures[name];
    const { rank, is_relay, entry } = record.qualification;
    const view = summary(record);
    expect(view.container.querySelector('.summary-bubble-time').textContent).toBe(entry.time.replace(/[@#]/g, ''));
    expect(screen.getByText(`Bubble (#${rank})`)).toBeTruthy();
    view.unmount();
    const roster = render(<EventCard eventGroup={record} />);
    const highlighted = roster.container.querySelectorAll('.bubble-cutoff');
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0].textContent).toContain(is_relay ? entry.team : entry.athlete);
    expect(highlighted[0].textContent).toContain(entry.time.replace(/[@#]/g, ''));
    expect(highlighted[0].querySelector('.rank-cell').textContent).toBe(String(rank));
    expect(screen.getAllByRole('columnheader')).toHaveLength(is_relay ? 3 : 4);
  });

  it('uses generated relay classification rather than inferring from the display name', () => {
    const record = { ...fixtures.relay.record, event: 'Saved event label' };
    render(<EventCard eventGroup={record} />);
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
    expect(screen.getByText('Top 12 list positions')).toBeTruthy();
    expect(screen.getByText('School 12')).toBeTruthy();
  });

  it.each(['short', 'missing'])('keeps %s roster visible without inventing a cutoff', name => {
    const { record } = fixtures[name];
    const view = summary(record);
    expect(screen.getByText('Cutoff unavailable')).toBeTruthy();
    view.unmount();
    const roster = render(<EventCard eventGroup={record} />);
    expect(screen.getByText('Cutoff unavailable')).toBeTruthy();
    expect(roster.container.querySelector('.bubble-cutoff')).toBeNull();
    expect(screen.getAllByRole('row')).toHaveLength(record.rankings.length + 1);
  });

  it.each([
    undefined, null, {},
    { rank: 12, is_relay: true, status: 'available', entry: null },
    { rank: 12, is_relay: true, status: 'available', entry: { rank: 16, athlete: 'Wrong', time: '3:00.00' } },
    { rank: '12', is_relay: true, status: 'missing_rank', entry: null },
    { rank: 12, is_relay: true, status: 'missing_rank', entry: fixtures.relay.record.qualification.entry },
    { rank: 12, is_relay: true, status: 'available', entry: { rank: 12, athlete: 'Wrong', time: 123 } },
  ])('fails closed for malformed metadata %#', qualification => {
    const record = { ...fixtures.relay.record, qualification };
    const view = summary(record);
    expect(screen.getAllByText('Cutoff unavailable').length).toBeGreaterThan(0);
    view.unmount();
    const roster = render(<EventCard eventGroup={record} />);
    expect(screen.getByText('Cutoff unavailable')).toBeTruthy();
    expect(roster.container.querySelector('.bubble-cutoff')).toBeNull();
  });
});

describe('qualification across views and chart input', () => {
  it('keeps current progression gaps and uses the same cutoff as the roster', async () => {
    const { record } = fixtures.relay;
    const summary = { ...fixtures.relay.summary, cutoff_rank: 16, cutoff_time: '9.99', cutoff_athlete: 'Wrong athlete' };
    serve([record], [snapshot(summary, '2026-01-01'), snapshot(fixtures.short.summary, '2026-01-02'), snapshot(summary, '2026-01-03')]);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({});
    const view = render(<Monitor initialSeason="indoor" />);
    await screen.findByText('Bubble (#12)');
    fireEvent.click(screen.getByRole('button', { name: '4 x 400 Relay', exact: true }));
    await waitFor(() => expect(chart.configs.length).toBeGreaterThan(0));
    const config = chart.configs.at(-1);
    expect(config.data.datasets[0].data).toEqual([192.27, null, 192.27]);
    expect(config.data.datasets[0].spanGaps).toBe(false);
    expect(config.data.datasets[0].label).toContain('Rank 12');
    expect(view.container.querySelector('.bubble-cutoff .rank-cell').textContent).toBe('12');
  });

  it('uses generated history for summaries, charts and loaded roster highlights', async () => {
    const { record } = fixtures.old;
    const summary = { ...fixtures.old.summary, cutoff_rank: 16, cutoff_time: '9.99', cutoff_athlete: 'Wrong athlete' };
    serve([fixtures.relay.record], [summary, fixtures.old_missing.summary], [record, fixtures.old_missing.record]);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({});
    const view = render(<Archive />);
    await screen.findByText('2023-2024 · #12');
    expect(view.container.querySelector('.summary-bubble-time').textContent).toBe('3:12.27');
    fireEvent.click(screen.getByRole('button', { name: '4 x 400 Relay', exact: true }));
    await waitFor(() => expect(chart.configs.length).toBeGreaterThan(0));
    expect(chart.configs.at(-1).data.datasets[0].data).toEqual([192.27, null]);
    const buttons = screen.getAllByRole('button', { name: 'View Full Roster' });
    fireEvent.click(buttons[0]);
    await screen.findByText('2023-2024 Qualifying Roster');
    const modal = view.container.querySelector('.archive-modal-content');
    expect(within(modal).getByText('Bubble Cutoff')).toBeTruthy();
    expect(within(modal).getByText('Bubble Cutoff').closest('.historical-roster-list > div').textContent).toContain('#12');
    fireEvent.click(within(modal).getByRole('button', { name: '×' }));
    fireEvent.click(buttons[1]);
    await screen.findByText('2024-2025 Qualifying Roster');
    const missingModal = view.container.querySelector('.archive-modal-content');
    expect(within(missingModal).queryByText('Bubble Cutoff')).toBeNull();
    expect(within(missingModal).getByText('Cutoff unavailable')).toBeTruthy();
    expect(missingModal.querySelectorAll('.historical-roster-list > div')).toHaveLength(2);
  });

  it('does not use legacy summary fields when qualification metadata is absent', async () => {
    const legacy = { ...fixtures.old.summary };
    delete legacy.qualification;
    serve([fixtures.relay.record], [legacy]);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({});
    render(<Archive />);
    await waitFor(() => expect(screen.queryByText('Loading archive data...')).toBeNull());
    expect(screen.getAllByText('Cutoff unavailable').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '4 x 400 Relay', exact: true }));
    await waitFor(() => expect(chart.configs.length).toBeGreaterThan(0));
    expect(chart.configs.at(-1).data.datasets[0].data).toEqual([null]);
    expect(screen.queryByText(/Rank 16/)).toBeNull();
  });
});
