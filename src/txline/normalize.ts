import type { NormalizedOddsEvent, NormalizedScoreEvent } from './types.js';

function isPair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  );
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
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.fixtureId !== 'string' && typeof r.fixtureId !== 'number') return false;
  if (typeof r.seq !== 'number' || typeof r.ts !== 'number' || typeof r.gameState !== 'string') {
    return false;
  }
  if (typeof r.scoreSoccer !== 'object' || r.scoreSoccer === null) return false;
  const s = r.scoreSoccer as Record<string, unknown>;
  return isPair(s.Goals) && isPair(s.YellowCards) && isPair(s.RedCards) && isPair(s.Corners);
}

export function normalizeScoreEvent(raw: unknown): NormalizedScoreEvent | null {
  if (!isRawScorePayload(raw)) return null;
  const s = raw.scoreSoccer;
  return {
    fixtureId: String(raw.fixtureId),
    seq: raw.seq,
    ts: raw.ts,
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
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.fixtureId !== 'string' && typeof r.fixtureId !== 'number') return false;
  if (typeof r.seq !== 'number' || typeof r.ts !== 'number') return false;
  if (!isNumberArray(r.Pct) || r.Pct.length < 3) return false;
  if (!isStringArray(r.PriceNames) || !isNumberArray(r.Prices)) return false;
  if (typeof r.InRunning !== 'boolean' || typeof r.GameState !== 'string') return false;
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
    ts: raw.ts,
    pct: { home: home ?? 0, draw: draw ?? 0, away: away ?? 0 },
    markets,
    inRunning: raw.InRunning,
    gameState: raw.GameState,
  };
}
