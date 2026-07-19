import { describe, it, expect } from 'vitest';
import { runMigration } from '../src/db/migrate.js';
import type { Db } from '../src/db/types.js';

describe('migration', () => {
  it('runs the schema sql once', async () => {
    const calls: string[] = [];
    const db: Db = {
      query: async (text) => {
        calls.push(text);
        return { rows: [] };
      },
    };
    await runMigration(db);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('create table if not exists predictions');
    expect(calls[0]).toContain('create table if not exists feed_events');
  });
});
