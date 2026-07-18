import { describe, it, expect } from 'vitest';
import { baseKeysFor, settlementKeys } from '../src/settlement/keys.js';

describe('baseKeysFor', () => {
  it('returns [1, 2] for goal', () => {
    expect(baseKeysFor('goal')).toEqual([1, 2]);
  });

  it('returns [3, 4] for card (yellow base keys)', () => {
    expect(baseKeysFor('card')).toEqual([3, 4]);
  });

  it('returns [7, 8] for corner', () => {
    expect(baseKeysFor('corner')).toEqual([7, 8]);
  });

  it('throws for foul (not provable)', () => {
    expect(() => baseKeysFor('foul')).toThrow();
  });
});

describe('settlementKeys', () => {
  it('1st-half team-1 goal is 1001', () => {
    expect(settlementKeys('goal', '1H')).toEqual([1001, 1002]);
  });

  it('half-time shares the 1st-half prefix', () => {
    expect(settlementKeys('goal', 'HT')).toEqual([1001, 1002]);
  });

  it('full-match corners are the bare base keys (prefix 0)', () => {
    expect(settlementKeys('corner', 'FT')).toEqual([7, 8]);
  });

  it('2nd-half card is 3003/3004', () => {
    expect(settlementKeys('card', '2H')).toEqual([3003, 3004]);
  });

  it('extra time prefixes with 4000', () => {
    expect(settlementKeys('goal', 'ET')).toEqual([4001, 4002]);
  });

  it('penalties prefix with 6000', () => {
    expect(settlementKeys('card', 'PENS')).toEqual([6003, 6004]);
  });

  it('foul (non-provable) yields no settlement keys', () => {
    expect(settlementKeys('foul', 'FT')).toEqual([]);
    expect(settlementKeys('foul', '1H')).toEqual([]);
  });
});
