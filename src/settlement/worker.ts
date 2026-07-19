import type { Db } from '../db/types.js';
import type { Market } from '../schemas/index.js';
import { normalizeScoreEvent } from '../txline/normalize.js';
import { fetchStatProof } from '../txline/proof.js';
import { verifyStat } from '../onchain/verifier.js';
import { sendPayout, solToLamports } from '../onchain/stake.js';
import { baseKeysFor } from './keys.js';
import { resolvePrediction, type ScoreFeedEvent, type SettleablePrediction } from './settle.js';

interface ResolvingRow {
  id: string;
  address: string;
  match_id: string;
  market: Market;
  provable: boolean;
  potential_sol: string;
  stamped_at: string | null;
  window_min: number;
}

interface FeedRow {
  id: number;
  payload: unknown;
}

async function loadScoreEvents(db: Db, matchId: string): Promise<ScoreFeedEvent[]> {
  const { rows } = await db.query<FeedRow>(
    `select id, payload from feed_events where fixture_id = $1 and kind = 'score' order by seq asc`,
    [matchId],
  );
  const events: ScoreFeedEvent[] = [];
  for (const row of rows) {
    const normalized = normalizeScoreEvent(row.payload);
    if (normalized === null) continue;
    events.push({ id: String(row.id), ts: normalized.ts, cumulative: normalized.cumulative });
  }
  return events;
}

// The settled feed event's `seq` isn't carried by `ScoreFeedEvent` (only `id`), so it's
// looked up from `proofId` (a feed_events.id — NOT the `fixtureId:ts` string verifyStat
// builds internally for its own return value) rather than threaded through resolvePrediction.
//
// A SINGLE stat key is requested (the side that actually changed) so the proof carries one
// `statsToProve` leaf: `buildValidateStatArgs` then leaves `stat_b`/`op` both null, which is
// the only combination the on-chain program accepts (IDL errors 6024-6026 revert on
// `stat_b: Some` + `op: None`). Requesting both home+away keys reverts every call.
async function fetchOnChainVerdict(
  db: Db,
  matchId: string,
  market: Market,
  proofId: string,
  side: 'home' | 'away',
): Promise<boolean | undefined> {
  if (proofId === 'none') return undefined;
  const fixtureId = Number(matchId);
  if (Number.isNaN(fixtureId)) return undefined;
  const { rows } = await db.query<{ seq: number }>(`select seq from feed_events where id = $1`, [proofId]);
  const seq = rows[0]?.seq;
  if (seq === undefined) return undefined;
  const statKey = String(baseKeysFor(market)[side === 'home' ? 0 : 1]);
  const proof = await fetchStatProof(fixtureId, seq, statKey);
  // ponytail: threshold 0 is a de-risk placeholder to prove a real boolean comes back;
  // real threshold = the baseline count once we go beyond de-risk.
  const chain = await verifyStat(proof, { threshold: 0, comparison: 'GreaterThan' });
  return chain.ok;
}

async function settleOne(db: Db, row: ResolvingRow, events: ScoreFeedEvent[], now: number): Promise<void> {
  const prediction: SettleablePrediction = {
    market: row.market,
    provable: row.provable,
    potentialSol: Number(row.potential_sol),
    stampedAt: Number(row.stamped_at ?? 0),
    windowMin: row.window_min,
  };
  const outcome = resolvePrediction(prediction, events, now);
  if (outcome === null) return;

  // Never blocks off-chain settlement: a proof/network failure just leaves
  // `verifiedOnChain` unset and the off-chain predicate stays the source of truth.
  // A 'lost' outcome has no `resolvedEvent` — nothing changed, so there's nothing to prove.
  const side = outcome.settlement.resolvedEvent?.side;
  if (side !== undefined) {
    try {
      const verified = await fetchOnChainVerdict(db, row.match_id, row.market, outcome.settlement.proofId, side);
      if (verified !== undefined) outcome.settlement.verifiedOnChain = verified;
    } catch (err) {
      console.warn('on-chain verify skipped:', err instanceof Error ? err.message : err);
    }
  }

  if (outcome.status === 'won') {
    // Atomic claim so overlapping ticks can't double-pay.
    const claim = await db.query(
      `update predictions set status='settling' where id=$1 and status='resolving'`,
      [row.id],
    );
    if (claim.rowCount === 0) return; // already claimed/settled
    try {
      const sig = await sendPayout(row.address, solToLamports(outcome.payoutSol));
      outcome.settlement.payoutTxHash = sig;
    } catch (err) {
      console.error('payout failed, leaving prediction in settling for retry', row.id, err);
      // ponytail: failed send leaves row 'settling'; a later tick re-selects only if we
      // reset to 'resolving'. For the demo we reset here so it retries; durable fix = record intent first.
      await db.query(`update predictions set status = 'resolving' where id = $1 and status = 'settling'`, [row.id]);
      return;
    }
  }

  // `status in ('resolving','settling')` is the idempotency guard: a prediction settled by
  // an earlier tick (or a concurrent run) is never re-settled or paid twice.
  await db.query(
    `update predictions set status = $1, settlement = $2 where id = $3 and status in ('resolving','settling')`,
    [outcome.status, outcome.settlement, row.id],
  );
}

export async function runSettlementTick(db: Db, now: number = Date.now()): Promise<void> {
  const { rows } = await db.query<ResolvingRow>(
    `select id, address, match_id, market, provable, potential_sol, stamped_at, window_min
     from predictions where status = 'resolving' and provable = true`,
  );
  if (rows.length === 0) return;

  const eventsByMatch = new Map<string, ScoreFeedEvent[]>();
  for (const row of rows) {
    if (!eventsByMatch.has(row.match_id)) {
      eventsByMatch.set(row.match_id, await loadScoreEvents(db, row.match_id));
    }
    const events = eventsByMatch.get(row.match_id);
    if (events) {
      await settleOne(db, row, events, now);
    }
  }
}

export interface SettlementWorker {
  stop: () => void;
}

export function startSettlementWorker(db: Db, intervalMs = 10_000): SettlementWorker {
  const timer = setInterval(() => {
    runSettlementTick(db).catch((error: unknown) => {
      console.error('settlement tick failed', error);
    });
  }, intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
