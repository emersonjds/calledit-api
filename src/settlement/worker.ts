import type { Db } from '../db/types.js';
import type { Market } from '../schemas/index.js';
import { normalizeScoreEvent } from '../txline/normalize.js';
import { resolvePrediction, type ScoreFeedEvent, type SettleablePrediction } from './settle.js';

interface ResolvingRow {
  id: string;
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

  // `where status = 'resolving'` is the idempotency guard: a prediction settled by
  // an earlier tick (or a concurrent run) is never re-settled or paid twice.
  await db.query(
    `update predictions set status = $1, settlement = $2 where id = $3 and status = 'resolving'`,
    [outcome.status, outcome.settlement, row.id],
  );
}

export async function runSettlementTick(db: Db, now: number = Date.now()): Promise<void> {
  const { rows } = await db.query<ResolvingRow>(
    `select id, match_id, market, provable, potential_sol, stamped_at, window_min
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
