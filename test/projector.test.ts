import { describe, it, expect } from 'vitest';
import { projectSnapshot } from '../src/services/projector.js';
import { matchSnapshotSchema, type TeamInfo } from '../src/schemas/index.js';
import type { NormalizedOddsEvent, NormalizedScoreEvent, ScoreCumulative } from '../src/txline/types.js';

const home: TeamInfo = { code: 'BRA', name: 'Brazil', flag: '🇧🇷' };
const away: TeamInfo = { code: 'ARG', name: 'Argentina', flag: '🇦🇷' };
const teams = { home, away };

const ZERO: ScoreCumulative = {
  goalsHome: 0,
  goalsAway: 0,
  yellowHome: 0,
  yellowAway: 0,
  redHome: 0,
  redAway: 0,
  cornersHome: 0,
  cornersAway: 0,
};

function scoreEvent(seq: number, cumulative: Partial<ScoreCumulative> = {}): NormalizedScoreEvent {
  return {
    fixtureId: 'm1',
    seq,
    ts: 1_700_000_000_000 + seq,
    gameState: '1H',
    cumulative: { ...ZERO, ...cumulative },
  };
}

function oddsEvent(seq: number, overrides: Partial<NormalizedOddsEvent> = {}): NormalizedOddsEvent {
  return {
    fixtureId: 'm1',
    seq,
    ts: 1_700_000_000_000 + seq,
    pct: { home: 0.33, draw: 0.34, away: 0.33 },
    markets: [],
    inRunning: false,
    gameState: '1H',
    ...overrides,
  };
}

describe('projectSnapshot', () => {
  it('diffs consecutive score events into a goal/home event and score [1,0]', () => {
    const snapshot = projectSnapshot('m1', [scoreEvent(1), scoreEvent(2, { goalsHome: 1 })], [], teams);
    expect(snapshot.score).toEqual([1, 0]);
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]).toMatchObject({ type: 'goal', side: 'home' });
  });

  it('takes pct and markets from the latest odds event', () => {
    const odds = [
      oddsEvent(1, { pct: { home: 0.4, draw: 0.3, away: 0.3 }, markets: [{ market: 'goal', multiplier: 1.5 }] }),
      oddsEvent(2, { pct: { home: 0.6, draw: 0.2, away: 0.2 }, markets: [{ market: 'corner', multiplier: 2 }] }),
    ];
    const snapshot = projectSnapshot('m1', [], odds, teams);
    expect(snapshot.pct).toEqual({ home: 0.6, draw: 0.2, away: 0.2 });
    expect(snapshot.markets).toEqual([{ market: 'corner', multiplier: 2 }]);
  });

  it('output parses cleanly against matchSnapshotSchema', () => {
    const snapshot = projectSnapshot(
      'm1',
      [scoreEvent(1), scoreEvent(2, { goalsHome: 1, cornersAway: 1 })],
      [oddsEvent(1, { inRunning: true })],
      teams,
    );
    expect(() => matchSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it('derives live and clockMin from the scores stream, not odds', () => {
    const running: NormalizedScoreEvent = {
      ...scoreEvent(1),
      clockRunning: true,
      clockSeconds: 1798,
      statusId: 2,
    };
    const snapshot = projectSnapshot('m1', [running], [oddsEvent(1, { inRunning: false })], teams);
    expect(snapshot.live).toBe(true);
    expect(snapshot.clockMin).toBe(29);
  });

  it('empty events produce a valid empty-ish snapshot, with default markets so the board is bettable', () => {
    const snapshot = projectSnapshot('m1', [], [], teams);
    expect(snapshot.score).toEqual([0, 0]);
    expect(snapshot.events).toEqual([]);
    expect(snapshot.pct).toEqual({ home: 0, draw: 0, away: 0 });
    expect(snapshot.markets).toEqual([
      { market: 'goal', multiplier: 2.0 },
      { market: 'card', multiplier: 1.8 },
      { market: 'corner', multiplier: 1.6 },
    ]);
    expect(snapshot.live).toBe(false);
    expect(() => matchSnapshotSchema.parse(snapshot)).not.toThrow();
  });
});
