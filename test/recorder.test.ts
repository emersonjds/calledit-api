import { describe, it, expect } from 'vitest';
import { recordRawEvent } from '../src/ingester/recorder.js';
import type { Db } from '../src/db/types.js';

interface RecordedCall {
  text: string;
  params: unknown[] | undefined;
}

describe('recordRawEvent', () => {
  it('issues one idempotent insert with the right params', async () => {
    const calls: RecordedCall[] = [];
    const db: Db = {
      query: async (text, params) => {
        calls.push({ text, params });
        return { rows: [] };
      },
    };

    await recordRawEvent(db, {
      fixtureId: 'm1',
      seq: 3,
      kind: 'score',
      ts: 1_700_000_000_000,
      payload: { a: 1 },
    });

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.text).toMatch(/insert into feed_events/i);
    expect(call.text).toMatch(/on conflict \(fixture_id, kind, seq\) do nothing/i);
    expect(call.params).toEqual(['m1', 3, 'score', new Date(1_700_000_000_000), { a: 1 }]);
  });
});
