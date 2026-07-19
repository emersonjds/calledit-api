import type { NormalizedOddsEvent, NormalizedScoreEvent } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidSeq(seq: unknown): seq is number {
  return typeof seq === 'number' && Number.isInteger(seq) && seq >= 1;
}

// verify against live sample: TxLINE's `ts` unit (seconds vs milliseconds) is
// unconfirmed at doc time. Values below 1e12 can't be a millisecond timestamp
// for any date in this era, so treat them as seconds.
export function toMillis(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts;
}

// Real TxLINE /api/scores/stream shape (live-captured, fixture 18257739):
// PascalCase envelope, `Stats` a flat statId->cumulative map (both teams, all periods),
// `Clock.Seconds`/`Clock.Running` the real match clock. See src/settlement/keys.ts BASE_KEYS
// for the statId mapping — full-time-total cumulative reads straight off keys "1".."8".
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

// statId keys are cumulative-for-whole-match at the un-prefixed base key (see BASE_KEYS in
// src/settlement/keys.ts): "1".."8" = goals/cards/reds/corners, [home, away]. Missing key = 0.
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

// Real TxLINE /api/odds/stream shape (live-captured): one frame = one bookmaker market line
// (`SuperOddsType`, e.g. "OVERUNDER_PARTICIPANT_GOALS" with PriceNames ["over","under"]), NOT a
// fixed [home,draw,away] 1x2 market. No `Seq` field at all, `GameState` can be null, `Pct`
// entries are strings (sometimes "NA"). Odds never drives anything critical — the scores stream
// carries `Seq`/live/clock — so this only needs to not crash and surface inRunning/gameState.
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
    return Number.isFinite(n) ? n : 0; // "NA" -> 0
  }
  return 0;
}

export function normalizeOddsEvent(raw: unknown): NormalizedOddsEvent | null {
  if (!isRawOddsPayload(raw)) return null;
  const pct = Array.isArray(raw.Pct) ? raw.Pct.map(parsePct) : [];
  const ts = toMillis(raw.Ts);
  return {
    fixtureId: String(raw.FixtureId),
    // No `Seq` on odds frames; `Ts` (ms) stands in as an ordering/idempotency key since odds
    // never drives live/clock/settlement — only the scores stream's real `Seq` does.
    seq: ts,
    ts,
    pct: { home: pct[0] ?? 0, draw: pct[1] ?? 0, away: pct[2] ?? 0 },
    // ponytail: raw PriceNames/Prices are one bookmaker line per SuperOddsType (e.g. over/under
    // goals), not our domain market keys (goal/card/corner) — mapping one to the other isn't
    // meaningful, so odds never populates `markets`; projector.ts falls back to static defaults.
    markets: [],
    inRunning: raw.InRunning === true,
    gameState: typeof raw.GameState === 'string' ? raw.GameState : '',
  };
}
