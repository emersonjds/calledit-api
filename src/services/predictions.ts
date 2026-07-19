import { randomUUID } from 'node:crypto';
import type { Db } from '../db/types.js';
import type { CommitPredictionInput, Prediction } from '../schemas/index.js';
import { isProvable, multiplierFor, payout } from './markets.js';
import { getFixtureKickoff } from './fixtures.js';
import { verifyStakeTransfer, solToLamports } from '../onchain/stake.js';

// The raw TxLINE feed has no match-clock minute, so the "called at" minute is
// derived from the fixture kickoff and the on-chain stamp time. Cosmetic — a
// failure here must never block a commit, so it always falls back to 0.
async function matchMinuteAt(matchId: string, stampedAt: number): Promise<number> {
  try {
    const kickoff = await getFixtureKickoff(matchId);
    if (kickoff && stampedAt > kickoff) return Math.floor((stampedAt - kickoff) / 60_000);
  } catch {
    // ignore — clock is display-only
  }
  return 0;
}

interface PredictionRow {
  id: string;
  match_id: string;
  market: Prediction['market'];
  provable: boolean;
  stake_sol: string;
  multiplier: string;
  potential_sol: string;
  at_clock_min: number;
  window_min: number;
  status: Prediction['status'];
  tx_hash: string | null;
  stamped_at: string | null;
  seq: number | null;
  epoch_day: number | null;
  settlement: Prediction['settlement'] | null;
}

function rowToPrediction(row: PredictionRow): Prediction {
  return {
    id: row.id,
    matchId: row.match_id,
    market: row.market,
    provable: row.provable,
    stakeSol: Number(row.stake_sol),
    multiplier: Number(row.multiplier),
    potentialSol: Number(row.potential_sol),
    atClockMin: row.at_clock_min,
    windowMin: row.window_min,
    status: row.status,
    stamp: {
      txHash: row.tx_hash ?? '',
      stampedAt: Number(row.stamped_at ?? 0),
      seq: row.seq ?? 1,
      epochDay: row.epoch_day ?? 0,
    },
    ...(row.settlement ? { settlement: row.settlement } : {}),
  };
}

export async function createPrediction(db: Db, input: CommitPredictionInput): Promise<Prediction> {
  const id = randomUUID();
  const provable = isProvable(input.market);
  const multiplier = multiplierFor(input.market);
  const potentialSol = payout(input.stakeSol, multiplier);
  const windowMin = 3;

  const stakeLamports = solToLamports(input.stakeSol);
  const stake = await verifyStakeTransfer(input.stakeTxSig, input.address, stakeLamports);
  if (!stake.ok) {
    const err = new Error(`stake transfer not verified: ${stake.reason ?? 'unknown'}`);
    (err as Error & { statusCode?: number }).statusCode = 400;
    throw err;
  }
  const stampedAt = stake.blockTime ? stake.blockTime * 1000 : Date.now();
  const atClockMin = await matchMinuteAt(input.matchId, stampedAt);
  const seq = 1;
  const epochDay = Math.floor(stampedAt / 86_400_000);
  const txHash = input.stakeTxSig;

  try {
    await db.query(
      `insert into predictions
         (id, address, match_id, market, provable, stake_sol, multiplier, potential_sol,
          at_clock_min, window_min, status, tx_hash, stamped_at, seq, epoch_day)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'resolving',$11,$12,$13,$14)`,
      [
        id,
        input.address,
        input.matchId,
        input.market,
        provable,
        input.stakeSol,
        multiplier,
        potentialSol,
        atClockMin,
        windowMin,
        txHash,
        stampedAt,
        seq,
        epochDay,
      ],
    );
  } catch (e) {
    // 23505 = postgres unique_violation. The `predictions_tx_hash_unique` index is the real
    // guard against stake-signature replay (a pre-insert select would be racy under
    // concurrent posts) — this just maps the DB rejection to the same 400 path.
    if ((e as { code?: string }).code === '23505') {
      const err = new Error('stake transfer already used');
      (err as Error & { statusCode?: number }).statusCode = 400;
      throw err;
    }
    throw e;
  }

  return {
    id,
    matchId: input.matchId,
    market: input.market,
    provable,
    stakeSol: input.stakeSol,
    multiplier,
    potentialSol,
    atClockMin,
    windowMin,
    status: 'resolving',
    stamp: { txHash, stampedAt, seq, epochDay },
  };
}

export async function getPredictionById(db: Db, id: string): Promise<Prediction | null> {
  const { rows } = await db.query<PredictionRow>('select * from predictions where id = $1', [id]);
  return rows[0] ? rowToPrediction(rows[0]) : null;
}

export async function listByAddress(db: Db, address: string): Promise<Prediction[]> {
  const { rows } = await db.query<PredictionRow>(
    'select * from predictions where address = $1 order by created_at desc',
    [address],
  );
  return rows.map(rowToPrediction);
}
