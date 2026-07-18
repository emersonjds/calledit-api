import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Db } from '../src/db/types.js';

const fakeDb: Db = { query: async () => ({ rows: [] }) };

describe('swagger', () => {
  it('serves an OpenAPI document at /docs/json', async () => {
    const app = buildApp({ db: fakeDb });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    const doc: { openapi?: string; info?: { title?: string } } = res.json();
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.info?.title).toBe('Called It API');
    await app.close();
  });
});
