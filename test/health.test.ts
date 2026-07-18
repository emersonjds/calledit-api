import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Db } from '../src/db/types.js';

const fakeDb: Db = { query: async () => ({ rows: [] }) };

describe('health', () => {
  it('GET /health returns ok', async () => {
    const app = buildApp({ db: fakeDb });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});
