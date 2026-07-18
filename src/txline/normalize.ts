import type { NormalizedOddsEvent, NormalizedScoreEvent } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  );
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

interface RawScorePayload {
  fixtureId: string | number;
  seq: number;
  ts: number;
  gameState: string;
  action?: string;
  scoreSoccer: {
    Goals: [number, number];
    YellowCards: [number, number];
    RedCards: [number, number];
    Corners: [number, number];
  };
}

// verify against live sample: TxLINE's real Scores JSON casing is unconfirmed at doc time.
// Assumes camelCase envelope fields (fixtureId/seq/ts/gameState/action) wrapping a PascalCase
// `scoreSoccer` cumulative block ({ Goals, YellowCards, RedCards, Corners }), each a
// [teamHome, teamAway] pair. Fix here — this is the only place that reads raw score field names.
function isRawScorePayload(raw: unknown): raw is RawScorePayload {
  if (!isRecord(raw)) return false;
  if (typeof raw.fixtureId !== 'string' && typeof raw.fixtureId !== 'number') return false;
  if (!isValidSeq(raw.seq) || typeof raw.ts !== 'number' || typeof raw.gameState !== 'string') {
    return false;
  }
  if (!isRecord(raw.scoreSoccer)) return false;
  const s = raw.scoreSoccer;
  return isPair(s.Goals) && isPair(s.YellowCards) && isPair(s.RedCards) && isPair(s.Corners);
}

export function normalizeScoreEvent(raw: unknown): NormalizedScoreEvent | null {
  if (!isRawScorePayload(raw)) return null;
  const s = raw.scoreSoccer;
  return {
    fixtureId: String(raw.fixtureId),
    seq: raw.seq,
    ts: toMillis(raw.ts),
    gameState: raw.gameState,
    ...(raw.action !== undefined ? { action: raw.action } : {}),
    cumulative: {
      goalsHome: s.Goals[0],
      goalsAway: s.Goals[1],
      yellowHome: s.YellowCards[0],
      yellowAway: s.YellowCards[1],
      redHome: s.RedCards[0],
      redAway: s.RedCards[1],
      cornersHome: s.Corners[0],
      cornersAway: s.Corners[1],
    },
  };
}

interface RawOddsPayload {
  fixtureId: string | number;
  seq: number;
  ts: number;
  Pct: number[];
  PriceNames: string[];
  Prices: number[];
  InRunning: boolean;
  GameState: string;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'number');
}

// verify against live sample: TxLINE's real OddsPayload JSON casing is unconfirmed at doc time.
// Assumes camelCase envelope (fixtureId/seq/ts) + PascalCase odds fields (Pct/PriceNames/Prices/
// InRunning/GameState) per the spec doc, with Pct ordered [home, draw, away]. Fix here only.
function isRawOddsPayload(raw: unknown): raw is RawOddsPayload {
  if (!isRecord(raw)) return false;
  if (typeof raw.fixtureId !== 'string' && typeof raw.fixtureId !== 'number') return false;
  if (!isValidSeq(raw.seq) || typeof raw.ts !== 'number') return false;
  if (!isNumberArray(raw.Pct) || raw.Pct.length < 3) return false;
  if (!isStringArray(raw.PriceNames) || !isNumberArray(raw.Prices)) return false;
  if (typeof raw.InRunning !== 'boolean' || typeof raw.GameState !== 'string') return false;
  return true;
}

export function normalizeOddsEvent(raw: unknown): NormalizedOddsEvent | null {
  if (!isRawOddsPayload(raw)) return null;
  const [home, draw, away] = raw.Pct;
  const markets = raw.PriceNames.map((market, i) => ({
    market,
    multiplier: raw.Prices[i] ?? 0,
  }));
  return {
    fixtureId: String(raw.fixtureId),
    seq: raw.seq,
    ts: toMillis(raw.ts),
    pct: { home: home ?? 0, draw: draw ?? 0, away: away ?? 0 },
    markets,
    inRunning: raw.InRunning,
    gameState: raw.GameState,
  };
}
