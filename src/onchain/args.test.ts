import { describe, it, expect } from 'vitest';
import { toBytes32, epochDayFromTs, buildValidateStatArgs } from './args.js';
import type { ScoresStatValidationV3 } from '../txline/proof.js';

const b64 = (n: number) => Buffer.alloc(32, n).toString('base64');

const proof: ScoresStatValidationV3 = {
  ts: 1_700_000_000_000,
  summary: {
    fixtureId: 42,
    updateStats: { updateCount: 3, minTimestamp: 1, maxTimestamp: 9 },
    eventStatsSubTreeRoot: b64(7),
  },
  eventStatRoot: b64(5),
  statsToProve: [{ stat: { key: 1, value: 2, period: 0 }, statProof: [{ hash: b64(1), isRightSibling: true }], eventStatRoot: b64(5) }],
  subTreeProof: [{ hash: b64(2), isRightSibling: false }],
  mainTreeProof: [{ hash: b64(3), isRightSibling: true }],
};

describe('toBytes32', () => {
  it('decodes a 32-byte base64 blob to a 32-length array', () => {
    const out = toBytes32(b64(9));
    expect(out).toHaveLength(32);
    expect(out.every((x) => x === 9)).toBe(true);
  });
  it('rejects wrong-length blobs', () => {
    expect(() => toBytes32(Buffer.alloc(31).toString('base64'))).toThrow();
  });
});

describe('epochDayFromTs', () => {
  it('derives epoch day from the proof ts, not the clock', () => {
    expect(epochDayFromTs(1_700_000_000_000)).toBe(Math.floor(1_700_000_000_000 / 86_400_000));
  });
});

describe('buildValidateStatArgs', () => {
  it('maps proof + predicate into positional validate_stat args', () => {
    const [ts, summary, fixtureProof, mainTreeProof, predicate, statA, statB, op] =
      buildValidateStatArgs(proof, { threshold: 1, comparison: 'GreaterThan' });
    expect(ts.toString()).toBe('1700000000000');
    expect(summary.fixtureId.toString()).toBe('42');
    expect(summary.eventsSubTreeRoot).toHaveLength(32);
    expect(fixtureProof).toHaveLength(1);
    expect(fixtureProof[0].isRightSibling).toBe(false);
    expect(mainTreeProof[0].isRightSibling).toBe(true);
    expect(predicate).toEqual({ threshold: 1, comparison: { greaterThan: {} } });
    expect(statA.statToProve.key).toBe(1);
    expect(statA.statProof).toHaveLength(1);
    expect(statB).toBeNull();
    expect(op).toBeNull();
  });
});
