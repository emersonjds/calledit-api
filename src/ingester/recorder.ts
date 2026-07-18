import type { Db } from '../db/types.js';

export interface RawFeedEvent {
  fixtureId: string;
  seq: number;
  kind: 'score' | 'odds';
  ts: number;
  payload: unknown;
}

// Idempotent: duplicate (fixtureId, kind, seq) from a reconnect is a no-op,
// not an error — TxLINE history is short, so every event is recorded raw.
export async function recordRawEvent(db: Db, event: RawFeedEvent): Promise<void> {
  await db.query(
    `insert into feed_events (fixture_id, seq, kind, ts, payload)
     values ($1, $2, $3, $4, $5)
     on conflict (fixture_id, kind, seq) do nothing`,
    [event.fixtureId, event.seq, event.kind, new Date(event.ts), event.payload],
  );
}
