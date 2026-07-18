import type { Market, MatchSnapshot } from '../schemas/index.js';

/** Match period, matching `matchSnapshotSchema.period` and the frontend's `Period` type. */
export type Period = MatchSnapshot['period'];

/**
 * TxLINE period prefix added to a base stat key. Mirrors the frontend's
 * `src/entities/match/periods.ts` PERIOD_PREFIX table exactly.
 *
 * Discrepancy vs. docs/txline-integration.md §4.1: the doc lists four extra-time
 * prefixes (ET1 4000, ET2 5000, PENS 6000, ET-total 7000), but the app's Period
 * type only has a single `ET` bucket — the frontend collapses all of that into
 * one prefix (4000). This mirrors the frontend, the source of truth encoded in
 * the app, so `ET` here also maps to 4000 only.
 */
const PERIOD_PREFIX: Record<Period, number> = {
  '1H': 1000,
  HT: 1000,
  '2H': 3000,
  ET: 4000,
  PENS: 6000,
  FT: 0,
};

/**
 * Base stat keys [team1, team2] per TxLINE's 8 provable keys (docs/txline-integration.md §4.1).
 * `card` uses the yellow-card base keys (3/4) — the app has one "card" market, not
 * separate yellow/red markets.
 */
const BASE_KEYS: Record<Exclude<Market, 'foul'>, readonly [number, number]> = {
  goal: [1, 2],
  card: [3, 4],
  corner: [7, 8],
};

function isProvableMarket(market: Market): market is Exclude<Market, 'foul'> {
  return market !== 'foul';
}

/**
 * [team1, team2] base stat keys for a provable market.
 * Throws for `foul` — it carries no Merkle proof and must never produce settlement keys.
 */
export function baseKeysFor(market: Market): readonly [number, number] {
  if (!isProvableMarket(market)) {
    throw new Error(`market "${market}" is not provable and has no settlement keys`);
  }
  return BASE_KEYS[market];
}

/**
 * Full settlement stat keys (prefix + base key) for a market×period.
 * Non-provable markets (`foul`) return an empty array instead of throwing — callers
 * building a settlement query can treat "no keys" as "nothing to settle" without a guard.
 */
export function settlementKeys(market: Market, period: Period): number[] {
  if (!isProvableMarket(market)) {
    return [];
  }
  const prefix = PERIOD_PREFIX[period];
  return BASE_KEYS[market].map((baseKey) => prefix + baseKey);
}
