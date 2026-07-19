import type { Market } from '../schemas/index.js';

const PROVABLE: Record<Market, boolean> = { goal: true, card: true, corner: true, foul: false };
const MULTIPLIER: Record<Market, number> = { goal: 2.0, card: 1.8, corner: 1.6, foul: 1.5 };

export function isProvable(market: Market): boolean {
  return PROVABLE[market];
}

export function multiplierFor(market: Market): number {
  return MULTIPLIER[market];
}

export function payout(stakeSol: number, multiplier: number): number {
  return stakeSol * multiplier;
}
