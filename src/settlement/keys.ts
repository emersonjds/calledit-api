import type { Market, MatchSnapshot } from '../schemas/index.js';

export type Period = MatchSnapshot['period'];

const PERIOD_PREFIX: Record<Period, number> = {
  '1H': 1000,
  HT: 1000,
  '2H': 3000,
  ET: 4000,
  PENS: 6000,
  FT: 0,
};

const BASE_KEYS: Record<Exclude<Market, 'foul'>, readonly [number, number]> = {
  goal: [1, 2],
  card: [3, 4],
  corner: [7, 8],
};

function isProvableMarket(market: Market): market is Exclude<Market, 'foul'> {
  return market !== 'foul';
}

export function baseKeysFor(market: Market): readonly [number, number] {
  if (!isProvableMarket(market)) {
    throw new Error(`market "${market}" is not provable and has no settlement keys`);
  }
  return BASE_KEYS[market];
}

export function settlementKeys(market: Market, period: Period): number[] {
  if (!isProvableMarket(market)) {
    return [];
  }
  const prefix = PERIOD_PREFIX[period];
  return BASE_KEYS[market].map((baseKey) => prefix + baseKey);
}
