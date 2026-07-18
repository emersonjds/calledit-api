import { randomUUID } from 'node:crypto';
import type { Db } from '../db/types.js';
import type { CommitPredictionInput, Prediction } from '../schemas/index.js';
import { isProvable, multiplierFor, payout } from './markets.js';

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
  const atClockMin = 0;
  const windowMin = 5;
  // ponytail: milestone-1 stub stamp — replaced by the real on-chain stamp in milestone 3.
  const stampedAt = Date.now();
  const seq = 1;
  const epochDay = Math.floor(stampedAt / 86_400_000);
  const txHash = `stub-${id}`;

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
