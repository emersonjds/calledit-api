import { describe, it, expect } from 'vitest';
import { isProvable, multiplierFor, payout } from '../src/services/markets.js';

describe('markets', () => {
  it('marks goal/card/corner provable and foul not', () => {
    expect(isProvable('goal')).toBe(true);
    expect(isProvable('card')).toBe(true);
    expect(isProvable('corner')).toBe(true);
    expect(isProvable('foul')).toBe(false);
  });

  it('returns a positive multiplier per market', () => {
    expect(multiplierFor('goal')).toBeGreaterThan(1);
    expect(multiplierFor('foul')).toBeGreaterThan(1);
  });

  it('computes payout as stake times multiplier', () => {
    expect(payout(0.5, 2)).toBe(1);
    expect(payout(0.25, 1.6)).toBeCloseTo(0.4);
  });
});
