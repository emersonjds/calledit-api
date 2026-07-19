import { describe, it, expect } from 'vitest';
import { parseTransferMatch } from './stake.js';

const from = 'AaAa11111111111111111111111111111111111111Aa';
const treasury = 'Bb2222222222222222222222222222222222222222Bb';

function tx(source: string, destination: string, lamports: number, err: unknown = null) {
  return {
    meta: { err },
    transaction: { message: { instructions: [
      { program: 'system', parsed: { type: 'transfer', info: { source, destination, lamports } } },
    ] } },
  };
}

describe('parseTransferMatch', () => {
  it('accepts a matching transfer', () => {
    expect(parseTransferMatch(tx(from, treasury, 1_000_000), from, treasury, 1_000_000).ok).toBe(true);
  });
  it('rejects wrong destination', () => {
    expect(parseTransferMatch(tx(from, 'CcC', 1_000_000), from, treasury, 1_000_000).ok).toBe(false);
  });
  it('rejects too-few lamports', () => {
    expect(parseTransferMatch(tx(from, treasury, 999), from, treasury, 1_000_000).ok).toBe(false);
  });
  it('rejects a failed tx', () => {
    expect(parseTransferMatch(tx(from, treasury, 1_000_000, { x: 1 }), from, treasury, 1_000_000).ok).toBe(false);
  });
  it('rejects null tx', () => {
    expect(parseTransferMatch(null, from, treasury, 1_000_000).ok).toBe(false);
  });
});
