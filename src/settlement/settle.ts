import type { Market, Settlement } from '../schemas/index.js';
import type { ScoreCumulative } from '../txline/types.js';

/** One score feed event, reduced to what the predicate needs. `id` doubles as the settlement proof id. */
export interface ScoreFeedEvent {
  id: string;
  ts: number;
  cumulative: ScoreCumulative;
}

export interface SettleablePrediction {
  market: Market;
  provable: boolean;
  potentialSol: number;
  stampedAt: number;
  windowMin: number;
}

export interface SettlementOutcome {
  status: 'won' | 'lost';
  payoutSol: number;
  settlement: Settlement;
}

type ProvableMarket = Exclude<Market, 'foul'>;

function isProvableMarket(market: Market): market is ProvableMarket {
  return market !== 'foul';
}

// [home, away] counts for the market's stat. `card` = yellow cards only,
// mirroring settlement/keys.ts's base-key choice (one card market, no red).
function sideCounts(cumulative: ScoreCumulative, market: ProvableMarket): readonly [number, number] {
  switch (market) {
    case 'goal':
      return [cumulative.goalsHome, cumulative.goalsAway];
    case 'card':
      return [cumulative.yellowHome, cumulative.yellowAway];
    case 'corner':
      return [cumulative.cornersHome, cumulative.cornersAway];
  }
}

function total(cumulative: ScoreCumulative, market: ProvableMarket): number {
  const [home, away] = sideCounts(cumulative, market);
  return home + away;
}

const EVENT_TYPE: Record<ProvableMarket, 'goal' | 'yellow' | 'corner'> = {
  goal: 'goal',
  card: 'yellow',
  corner: 'corner',
};

/**
 * Pure settlement predicate — no I/O, no clock reads.
 *
 * WON: the market's stat total (home + away) rises anywhere in
 * `(stampedAt, stampedAt + windowMin*60000]`.
 * LOST: that window fully elapses (relative to `now`) with no rise.
 * Returns null while still waiting: window open and nothing qualifying yet.
 * `foul` (not provable) always returns null — it never settles here.
 */
export function resolvePrediction(
  prediction: SettleablePrediction,
  events: readonly ScoreFeedEvent[],
  now: number,
): SettlementOutcome | null {
  if (!prediction.provable || !isProvableMarket(prediction.market)) {
    return null;
  }
  const market = prediction.market;
  const windowEnd = prediction.stampedAt + prediction.windowMin * 60_000;
  const sorted = [...events].sort((a, b) => a.ts - b.ts);

  // ponytail: no event at/before the stamp → assume a 0 baseline (call made
  // before the feed carried any stat yet for this fixture).
  const baselineEvent = [...sorted].reverse().find((event) => event.ts <= prediction.stampedAt);
  const baseline = baselineEvent ? total(baselineEvent.cumulative, market) : 0;
  const baselineHome = baselineEvent ? sideCounts(baselineEvent.cumulative, market)[0] : 0;

  const qualifying = sorted.find(
    (event) =>
      event.ts > prediction.stampedAt &&
      event.ts <= windowEnd &&
      total(event.cumulative, market) > baseline,
  );

  if (qualifying) {
    const [homeNow] = sideCounts(qualifying.cumulative, market);
    const side = homeNow > baselineHome ? 'home' : 'away';
    return {
      status: 'won',
      payoutSol: prediction.potentialSol,
      settlement: {
        proofId: qualifying.id,
        payoutSol: prediction.potentialSol,
        calledSecondsBefore: Math.round((qualifying.ts - prediction.stampedAt) / 1000),
        resolvedEvent: {
          id: qualifying.id,
          type: EVENT_TYPE[market],
          side,
          // ponytail: raw feed carries no match-clock minute; cosmetic field only,
          // add when a clock source (fixture kickoff + gameState) is wired in.
          clockMin: 0,
        },
      },
    };
  }

  if (now < windowEnd) {
    return null;
  }

  const lastEvent = sorted[sorted.length - 1];
  return {
    status: 'lost',
    payoutSol: 0,
    settlement: {
      proofId: lastEvent ? lastEvent.id : 'none',
      payoutSol: 0,
      calledSecondsBefore: 0,
      resolvedEvent: null,
    },
  };
}
