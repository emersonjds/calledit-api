import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { predictionSchema } from '../src/schemas/index.js';
import type { Db } from '../src/db/types.js';

function makeApp() {
  const store: Record<string, unknown>[] = [];
  const db: Db = {
    query: async (text: string, params?: unknown[]) => {
      if (text.startsWith('insert into predictions')) {
        store.push({ id: params![0], address: params![1] });
        return { rows: [] };
      }
      if (text.includes('where id = $1')) {
        const row = store.find((r) => r.id === params![0]);
        return { rows: row ? [fullRow(row.id as string, row.address as string)] : [] };
      }
      if (text.includes('where address = $1')) {
        const rows = store
          .filter((r) => r.address === params![0])
          .map((r) => fullRow(r.id as string, r.address as string));
        return { rows };
      }
      return { rows: [] };
    },
  };
  return buildApp({ db });
}

function fullRow(id: string, address: string) {
  return {
    id,
    address,
    match_id: 'm1',
    market: 'goal',
    provable: true,
    stake_sol: '0.5',
    multiplier: '2',
    potential_sol: '1',
    at_clock_min: 0,
    window_min: 5,
    status: 'resolving',
    tx_hash: `stub-${id}`,
    stamped_at: '1',
    seq: 1,
    epoch_day: 20000,
    settlement: null,
  };
}

describe('predictions routes', () => {
  it('POST creates a schema-valid prediction', async () => {
    const app = makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/predictions',
      payload: { matchId: 'm1', market: 'goal', stakeSol: 0.5, address: 'alice' },
    });
    expect(res.statusCode).toBe(200);
    expect(() => predictionSchema.parse(res.json())).not.toThrow();
    expect(res.json().provable).toBe(true);
    await app.close();
  });

  it('GET /:id returns 404 for unknown id', async () => {
    const app = makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/predictions/nope' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('GET list returns items for the address', async () => {
    const app = makeApp();
    await app.inject({
      method: 'POST',
      url: '/api/predictions',
      payload: { matchId: 'm1', market: 'goal', stakeSol: 0.5, address: 'alice' },
    });
    const res = await app.inject({ method: 'GET', url: '/api/predictions?address=alice' });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(1);
    await app.close();
  });
});
