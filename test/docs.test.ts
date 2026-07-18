import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Db } from '../src/db/types.js';

const fakeDb: Db = { query: async () => ({ rows: [] }) };

interface OpenApiOperation {
  summary?: string;
  tags?: string[];
}

interface OpenApiDoc {
  openapi?: string;
  info?: { title?: string; description?: string };
  paths?: Record<string, Record<string, OpenApiOperation>>;
}

describe('swagger', () => {
  it('serves an OpenAPI document at /docs/json', async () => {
    const app = buildApp({ db: fakeDb });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    const doc: OpenApiDoc = res.json();
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.info?.title).toBe('Called It API');
    expect(doc.info?.description).toBeTruthy();
    await app.close();
  });

  it('documents every route with a summary and at least one tag', async () => {
    const app = buildApp({ db: fakeDb });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    const doc: OpenApiDoc = res.json();
    const paths = doc.paths ?? {};
    const undocumented: string[] = [];
    for (const [path, operations] of Object.entries(paths)) {
      for (const [method, op] of Object.entries(operations)) {
        if (!op.summary || !op.tags || op.tags.length === 0) {
          undocumented.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }
    expect(undocumented).toEqual([]);
    expect(Object.keys(paths).length).toBeGreaterThan(0);
    await app.close();
  });
});
