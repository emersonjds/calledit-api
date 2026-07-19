import { describe, it, expect } from 'vitest';
import { resolvePrediction, type ScoreFeedEvent, type SettleablePrediction } from '../src/settlement/settle.js';
import type { ScoreCumulative } from '../src/txline/types.js';

const STAMP = 1_000_000;
const WINDOW_MIN = 5;
const ZERO: ScoreCumulative = {
  goalsHome: 0,
  goalsAway: 0,
  yellowHome: 0,
  yellowAway: 0,
  redHome: 0,
  redAway: 0,
  cornersHome: 0,
  cornersAway: 0,
};

function prediction(overrides: Partial<SettleablePrediction> = {}): SettleablePrediction {
  return {
    market: 'goal',
    provable: true,
    potentialSol: 4,
    stampedAt: STAMP,
    windowMin: WINDOW_MIN,
    ...overrides,
  };
}

function event(id: string, ts: number, cumulative: Partial<ScoreCumulative>): ScoreFeedEvent {
  return { id, ts, cumulative: { ...ZERO, ...cumulative } };
}

describe('resolvePrediction', () => {
  it('wins on a goal inside the window', () => {
    const events = [event('e1', STAMP + 60_000, { goalsHome: 1 })];
    const outcome = resolvePrediction(prediction(), events, STAMP + 61_000);
    expect(outcome).toEqual({
      status: 'won',
      payoutSol: 4,
      settlement: {
        proofId: 'e1',
        payoutSol: 4,
        calledSecondsBefore: 60,
        resolvedEvent: { id: 'e1', type: 'goal', side: 'home', clockMin: 0 },
      },
    });
  });

  it('loses once the window elapses with no change', () => {
    const events = [event('e1', STAMP + 10_000, { goalsHome: 0 })];
    const windowEnd = STAMP + WINDOW_MIN * 60_000;
    const outcome = resolvePrediction(prediction(), events, windowEnd);
    expect(outcome).toEqual({
      status: 'lost',
      payoutSol: 0,
      settlement: { proofId: 'e1', payoutSol: 0, calledSecondsBefore: 0, resolvedEvent: null },
    });
  });

  it('stays resolving (null) while the window is still open', () => {
    const outcome = resolvePrediction(prediction(), [], STAMP + 60_000);
    expect(outcome).toBeNull();
  });

  it('a card prediction is unaffected by a goal event', () => {
    const events = [event('e1', STAMP + 30_000, { goalsHome: 1 })];
    const windowEnd = STAMP + WINDOW_MIN * 60_000;
    const outcome = resolvePrediction(prediction({ market: 'card' }), events, windowEnd);
    expect(outcome?.status).toBe('lost');
  });

  it('never settles foul, even with a qualifying event and elapsed window', () => {
    const events = [event('e1', STAMP + 30_000, { goalsHome: 5 })];
    const windowEnd = STAMP + WINDOW_MIN * 60_000;
    const outcome = resolvePrediction(prediction({ market: 'foul', provable: false }), events, windowEnd);
    expect(outcome).toBeNull();
  });
});
