import { describe, it, expect } from 'vitest';
import { predictionSchema, commitPredictionSchema } from '../src/schemas/index.js';

describe('schemas', () => {
  it('accepts a valid prediction', () => {
    const valid = {
      id: 'p1',
      matchId: 'm1',
      market: 'goal',
      provable: true,
      stakeSol: 0.5,
      multiplier: 2,
      potentialSol: 1,
      atClockMin: 12,
      windowMin: 5,
      status: 'resolving',
      stamp: { txHash: 'stub-p1', stampedAt: 1, seq: 1, epochDay: 20000 },
    };
    expect(predictionSchema.parse(valid)).toBeTruthy();
  });

  it('rejects seq below 1', () => {
    const bad = {
      id: 'p1',
      matchId: 'm1',
      market: 'goal',
      provable: true,
      stakeSol: 0.5,
      multiplier: 2,
      potentialSol: 1,
      atClockMin: 12,
      windowMin: 5,
      status: 'resolving',
      stamp: { txHash: 'x', stampedAt: 1, seq: 0, epochDay: 20000 },
    };
    expect(() => predictionSchema.parse(bad)).toThrow();
  });

  it('rejects a non-positive stake in the request body', () => {
    expect(() =>
      commitPredictionSchema.parse({ matchId: 'm1', market: 'goal', stakeSol: 0, address: 'a' }),
    ).toThrow();
  });
});
