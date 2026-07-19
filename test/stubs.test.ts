import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Db } from '../src/db/types.js';
import {
  leaderboardSchema,
  matchSnapshotSchema,
  profileSchema,
  walletAccountSchema,
  walletOverviewSchema,
} from '../src/schemas/index.js';

const fakeDb: Db = { query: async () => ({ rows: [] }) };

describe('stub routes are schema-valid', () => {
  it('POST /api/wallet/connect', async () => {
    const app = buildApp({ db: fakeDb });
    const res = await app.inject({
      method: 'POST',
      url: '/api/wallet/connect',
      payload: { provider: 'phantom' },
    });
    expect(() => walletAccountSchema.parse(res.json())).not.toThrow();
    await app.close();
  });

  it('GET /api/feed/:matchId', async () => {
    const app = buildApp({ db: fakeDb });
    const res = await app.inject({ method: 'GET', url: '/api/feed/m1' });
    expect(() => matchSnapshotSchema.parse(res.json())).not.toThrow();
    await app.close();
  });

  it('GET /api/me, /api/leaderboard, /api/wallet', async () => {
    const app = buildApp({ db: fakeDb });
    const meRes = await app.inject({ method: 'GET', url: '/api/me?address=a' });
    expect(() => profileSchema.parse(meRes.json())).not.toThrow();
    const lbRes = await app.inject({ method: 'GET', url: '/api/leaderboard?address=a' });
    expect(() => leaderboardSchema.parse(lbRes.json())).not.toThrow();
    const walRes = await app.inject({ method: 'GET', url: '/api/wallet?address=a' });
    expect(() => walletOverviewSchema.parse(walRes.json())).not.toThrow();
    await app.close();
  });
});
