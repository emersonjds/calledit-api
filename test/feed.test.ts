import { describe, it, expect } from 'vitest';
import { getFeedSnapshot } from '../src/services/feed.js';
import { buildApp } from '../src/app.js';
import { matchSnapshotSchema, type TeamInfo } from '../src/schemas/index.js';
import type { Db } from '../src/db/types.js';

const teams: { home: TeamInfo; away: TeamInfo } = {
  home: { code: 'BRA', name: 'Brazil', flag: '🇧🇷' },
  away: { code: 'ARG', name: 'Argentina', flag: '🇦🇷' },
};

interface SeedRow {
  kind: 'score' | 'odds';
  seq: number;
  payload: unknown;
}

function makeDb(rows: SeedRow[]): Db {
  return { query: async () => ({ rows }) };
}

const scoreRow = (seq: number, goalsHome: number): SeedRow => ({
  kind: 'score',
  seq,
  payload: {
    FixtureId: 'm1',
    Seq: seq,
    Ts: 1_700_000_000_000 + seq,
    GameState: '2H',
    StatusId: 2,
    Clock: { Running: true, Seconds: 1798 },
    Stats: { '1': goalsHome, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7': 0, '8': 0 },
  },
});

const oddsRow: SeedRow = {
  kind: 'odds',
  seq: 1,
  payload: {
    FixtureId: 'm1',
    Ts: 1_700_000_000_001,
    SuperOddsType: 'OVERUNDER_PARTICIPANT_GOALS',
    GameState: null,
    InRunning: true,
    PriceNames: ['over', 'under'],
    Prices: [2035, 1966],
    Pct: ['55.928', '44.092'],
  },
};

describe('getFeedSnapshot', () => {
  it('returns a valid stub snapshot when there are zero rows', async () => {
    const snapshot = await getFeedSnapshot(makeDb([]), 'm1', teams);
    expect(() => matchSnapshotSchema.parse(snapshot)).not.toThrow();
    expect(snapshot.score).toEqual([0, 0]);
  });

  it('normalizes and projects seeded score+odds rows', async () => {
    const db = makeDb([scoreRow(1, 0), scoreRow(2, 1), oddsRow]);
    const snapshot = await getFeedSnapshot(db, 'm1', teams);
    expect(() => matchSnapshotSchema.parse(snapshot)).not.toThrow();
    expect(snapshot.score).toEqual([1, 0]);
    expect(snapshot.events).toHaveLength(1);
    // real odds frames carry bookmaker lines (over/under), not our goal/card/corner keys —
    // projector falls back to the static default markets list.
    expect(snapshot.markets).toEqual([
      { market: 'goal', multiplier: 2.0 },
      { market: 'card', multiplier: 1.8 },
      { market: 'corner', multiplier: 1.6 },
    ]);
    // live is driven by the scores stream's Clock.Running, not odds InRunning.
    expect(snapshot.live).toBe(true);
  });
});

describe('GET /api/feed/:matchId', () => {
  it('returns a schema-valid snapshot backed by a fake db', async () => {
    const app = buildApp({ db: makeDb([scoreRow(1, 0), scoreRow(2, 1)]) });
    const res = await app.inject({ method: 'GET', url: '/api/feed/m1' });
    expect(res.statusCode).toBe(200);
    expect(() => matchSnapshotSchema.parse(res.json())).not.toThrow();
    expect(res.json().score).toEqual([1, 0]);
    await app.close();
  });
});
