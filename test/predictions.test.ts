import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { commitPredictionSchema, predictionSchema } from '../src/schemas/index.js';
import type { Db } from '../src/db/types.js';

// Base58, pubkey-shaped — schema now rejects anything else (e.g. the old 'alice' fixture).
const ALICE = '2t5SHE9udJWswb5GqKMzvRhE836uyzkdkQJGf1sHhi8p';

const verifyStakeTransfer = vi.fn(async () => ({ ok: true, blockTime: 1_700_000_000 }));
vi.mock('../src/onchain/stake.js', () => ({
  verifyStakeTransfer: (...args: [string, string, number]) => verifyStakeTransfer(...args),
  solToLamports: (sol: number) => Math.round(sol * 1_000_000_000),
}));

function stringParam(params: unknown[] | undefined, index: number): string {
  const value = params?.[index];
  if (typeof value !== 'string') throw new Error(`expected string param at index ${index}`);
  return value;
}

function makeApp() {
  const store: { id: string; address: string; tx_hash: string }[] = [];
  const db: Db = {
    query: async (text: string, params?: unknown[]) => {
      if (text.startsWith('insert into predictions')) {
        const txHash = stringParam(params, 10);
        // Simulates the `predictions_tx_hash_unique` index (postgres unique_violation).
        if (store.some((r) => r.tx_hash === txHash)) {
          throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
        }
        store.push({ id: stringParam(params, 0), address: stringParam(params, 1), tx_hash: txHash });
        return { rows: [] };
      }
      if (text.includes('where id = $1')) {
        const id = stringParam(params, 0);
        const row = store.find((r) => r.id === id);
        return { rows: row ? [fullRow(row.id, row.address)] : [] };
      }
      if (text.includes('where address = $1')) {
        const address = stringParam(params, 0);
        const rows = store.filter((r) => r.address === address).map((r) => fullRow(r.id, r.address));
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
      payload: { matchId: 'm1', market: 'goal', stakeSol: 0.5, address: ALICE, stakeTxSig: 'sig-1' },
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
      payload: { matchId: 'm1', market: 'goal', stakeSol: 0.5, address: ALICE, stakeTxSig: 'sig-1' },
    });
    const res = await app.inject({ method: 'GET', url: `/api/predictions?address=${ALICE}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(1);
    await app.close();
  });

  it('POST rejects a replayed stakeTxSig with 400', async () => {
    const app = makeApp();
    const first = await app.inject({
      method: 'POST',
      url: '/api/predictions',
      payload: { matchId: 'm1', market: 'goal', stakeSol: 0.5, address: ALICE, stakeTxSig: 'sig-replay' },
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: 'POST',
      url: '/api/predictions',
      payload: { matchId: 'm1', market: 'card', stakeSol: 0.01, address: ALICE, stakeTxSig: 'sig-replay' },
    });
    expect(second.statusCode).toBe(400);
    expect(second.json().message).toMatch(/already used/);
    await app.close();
  });

  it('POST rejects an unverified stake with 400', async () => {
    verifyStakeTransfer.mockImplementationOnce(async () => ({ ok: false, blockTime: null, reason: 'no matching transfer instruction' }));
    const app = makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/predictions',
      payload: { matchId: 'm1', market: 'goal', stakeSol: 0.5, address: ALICE, stakeTxSig: 'sig-bad' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects a malformed address at the schema boundary', () => {
    const result = commitPredictionSchema.safeParse({
      matchId: 'm1',
      market: 'goal',
      stakeSol: 0.5,
      address: 'alice',
      stakeTxSig: 'sig-1',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a real pubkey-shaped address at the schema boundary', () => {
    const result = commitPredictionSchema.safeParse({
      matchId: 'm1',
      market: 'goal',
      stakeSol: 0.5,
      address: ALICE,
      stakeTxSig: 'sig-1',
    });
    expect(result.success).toBe(true);
  });
});
