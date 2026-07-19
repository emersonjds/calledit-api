import { describe, it, expect, vi } from 'vitest';
import type { Db, QueryResult } from '../db/types.js';
import { runSettlementTick } from './worker.js';

const sendPayoutMock = vi.fn(async (_to: string, _lamports: number) => 'fake-payout-sig');
vi.mock('../onchain/stake.js', () => ({
  sendPayout: (to: string, lamports: number) => sendPayoutMock(to, lamports),
  solToLamports: (sol: number) => Math.round(sol * 1_000_000_000),
}));

// >= 1e12 so normalizeScoreEvent's toMillis (seconds vs ms heuristic) passes it through untouched.
const STAMP = 1_700_000_000_000;

function scorePayload(seq: number, ts: number, goalsHome: number) {
  return {
    fixtureId: 'm1',
    seq,
    ts,
    gameState: '2H',
    scoreSoccer: {
      Goals: [goalsHome, 0],
      YellowCards: [0, 0],
      RedCards: [0, 0],
      Corners: [0, 0],
    },
  };
}

// Minimal in-memory Db double: a single predictable prediction row + one qualifying
// score event, enough to drive settleOne through claim -> pay -> finalize.
function makeDb() {
  let status: 'resolving' | 'settling' | 'won' | 'lost' = 'resolving';

  const db: Db = {
    query: async <T>(text: string): Promise<QueryResult<T>> => {
      if (text.includes(`from predictions where status = 'resolving'`)) {
        if (status !== 'resolving') return { rows: [] as T[] };
        return {
          rows: [
            {
              id: 'p1',
              address: 'winner-address',
              match_id: 'm1',
              market: 'goal',
              provable: true,
              potential_sol: '2',
              stamped_at: String(STAMP),
              window_min: 5,
            },
          ] as T[],
        };
      }
      if (text.includes('from feed_events where fixture_id')) {
        return { rows: [{ id: 1, payload: scorePayload(1, STAMP + 60_000, 1) }] as T[] };
      }
      if (text.includes(`status='settling' where id=$1 and status='resolving'`)) {
        if (status !== 'resolving') return { rows: [] as T[], rowCount: 0 };
        status = 'settling';
        return { rows: [] as T[], rowCount: 1 };
      }
      if (text.includes('select seq from feed_events where id')) {
        return { rows: [] as T[] }; // skip on-chain verify (network) in this unit test
      }
      if (text.includes(`status in ('resolving','settling')`)) {
        status = 'won';
        return { rows: [] as T[] };
      }
      return { rows: [] as T[] };
    },
  };
  return { db };
}

describe('runSettlementTick payout', () => {
  it('pays the winner once and records payoutTxHash', async () => {
    const { db } = makeDb();
    await runSettlementTick(db, STAMP + 61_000);
    expect(sendPayoutMock).toHaveBeenCalledTimes(1);
    expect(sendPayoutMock).toHaveBeenCalledWith('winner-address', 2_000_000_000);
  });

  it('never pays twice across overlapping ticks', async () => {
    sendPayoutMock.mockClear();
    const { db } = makeDb();
    await runSettlementTick(db, STAMP + 61_000);
    await runSettlementTick(db, STAMP + 61_000);
    expect(sendPayoutMock).toHaveBeenCalledTimes(1);
  });
});
