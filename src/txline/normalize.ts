import type { NormalizedOddsEvent, NormalizedScoreEvent } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidSeq(seq: unknown): seq is number {
  return typeof seq === 'number' && Number.isInteger(seq) && seq >= 1;
}

export function toMillis(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts;
}

interface RawScorePayload {
  FixtureId: string | number;
  Seq: number;
  Ts: number;
  GameState?: unknown;
  Action?: unknown;
  StatusId?: unknown;
  Clock?: { Running?: unknown; Seconds?: unknown };
  Stats?: Record<string, unknown>;
}

function isRawScorePayload(raw: unknown): raw is RawScorePayload {
  if (!isRecord(raw)) return false;
  if (typeof raw.FixtureId !== 'string' && typeof raw.FixtureId !== 'number') return false;
  return isValidSeq(raw.Seq) && typeof raw.Ts === 'number';
}

function readStat(stats: Record<string, unknown> | undefined, key: string): number {
  const v = stats?.[key];
  return typeof v === 'number' ? v : 0;
}

export function normalizeScoreEvent(raw: unknown): NormalizedScoreEvent | null {
  if (!isRawScorePayload(raw)) return null;
  const clock = isRecord(raw.Clock) ? raw.Clock : undefined;
  return {
    fixtureId: String(raw.FixtureId),
    seq: raw.Seq,
    ts: toMillis(raw.Ts),
    gameState: typeof raw.GameState === 'string' ? raw.GameState : '',
    ...(typeof raw.Action === 'string' ? { action: raw.Action } : {}),
    ...(typeof clock?.Seconds === 'number' ? { clockSeconds: clock.Seconds } : {}),
    ...(typeof clock?.Running === 'boolean' ? { clockRunning: clock.Running } : {}),
    ...(typeof raw.StatusId === 'number' ? { statusId: raw.StatusId } : {}),
    cumulative: {
      goalsHome: readStat(raw.Stats, '1'),
      goalsAway: readStat(raw.Stats, '2'),
      yellowHome: readStat(raw.Stats, '3'),
      yellowAway: readStat(raw.Stats, '4'),
      redHome: readStat(raw.Stats, '5'),
      redAway: readStat(raw.Stats, '6'),
      cornersHome: readStat(raw.Stats, '7'),
      cornersAway: readStat(raw.Stats, '8'),
    },
  };
}

interface RawOddsPayload {
  FixtureId: string | number;
  Ts: number;
  InRunning?: unknown;
  GameState?: unknown;
  Pct?: unknown;
}

function isRawOddsPayload(raw: unknown): raw is RawOddsPayload {
  if (!isRecord(raw)) return false;
  if (typeof raw.FixtureId !== 'string' && typeof raw.FixtureId !== 'number') return false;
  return typeof raw.Ts === 'number';
}

function parsePct(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function normalizeOddsEvent(raw: unknown): NormalizedOddsEvent | null {
  if (!isRawOddsPayload(raw)) return null;
  const pct = Array.isArray(raw.Pct) ? raw.Pct.map(parsePct) : [];
  const ts = toMillis(raw.Ts);
  return {
    fixtureId: String(raw.FixtureId),
    seq: ts,
    ts,
    pct: { home: pct[0] ?? 0, draw: pct[1] ?? 0, away: pct[2] ?? 0 },
    markets: [],
    inRunning: raw.InRunning === true,
    gameState: typeof raw.GameState === 'string' ? raw.GameState : '',
  };
}
