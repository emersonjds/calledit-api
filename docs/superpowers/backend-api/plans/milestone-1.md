# Called It Backend — Milestone 1 (API Skeleton) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable, deploy-ready Fastify API that serves every seam the Called It frontend calls, with predictions persisted to Postgres and the rest as valid-shaped stubs, documented in a clean Swagger UI.

**Architecture:** One Node (TypeScript, ESM) Fastify service. `buildApp({ db })` builds the instance and takes an injectable `Db` interface so routes are testable with a fake db (no Postgres needed in tests). Real runtime uses a `pg` Pool. Zod schemas mirror the frontend contracts and drive both validation and the OpenAPI doc.

**Tech Stack:** Node 20+, Fastify 5, `@fastify/swagger` + `@fastify/swagger-ui`, `fastify-type-provider-zod`, Zod 4, `@fastify/cors`, `pg`, `tsx`, Vitest.

## Global Constraints

- UI/response shapes must match the frontend Zod schemas (`called-it/src/shared/api/schemas.ts`) exactly.
- `stamp.seq` is an int `>= 1`; `epochDay` is an int. `provable` gates settlement.
- Provable markets: `goal`, `card`, `corner`. `foul` is `provable: false` and never settles.
- Secrets (`SERVICE_WALLET_SECRET`, `TXLINE_JWT`, `TXLINE_API_TOKEN`) never logged or committed; `.env` gitignored.
- ESM only (`"type": "module"`); TypeScript strict; no `any` (use `unknown` + narrowing).
- Commits: English, short imperative, lowercase, no trailing period; no AI/Claude mention, no `Co-Authored-By`.

---

### Task 1: Project bootstrap, health route, agents migration

**Files:**

- Create: `package.json`, `tsconfig.json`, `.env.example`, `src/config/env.ts`, `src/db/types.ts`, `src/app.ts`, `src/server.ts`, `src/routes/health.ts`
- Create: `.claude/agents/*` (copied from `../called-it/.claude/agents/`), `.mcp.json` (copied)
- Test: `test/health.test.ts`

**Interfaces:**

- Produces: `interface Db { query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }> }` (in `src/db/types.ts`)
- Produces: `buildApp(opts: { db: Db }): FastifyInstance` (in `src/app.ts`), decorates `app.db`
- Produces: `loadEnv(): { NODE_ENV: string; PORT: number; DATABASE_URL: string; ... }` (in `src/config/env.ts`)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "calledit-api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.8.0",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "migrate": "tsx src/db/migrate.ts",
    "type-check": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@fastify/cors": "^10.0.1",
    "@fastify/swagger": "^9.4.0",
    "@fastify/swagger-ui": "^5.2.0",
    "fastify": "^5.2.0",
    "fastify-type-provider-zod": "^4.0.2",
    "pg": "^8.13.1",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/node": "^24.7.0",
    "@types/pg": "^8.11.10",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^3.2.4"
  }
}
```

> Note: use TypeScript 5.x here (not the frontend's TS 7) — `fastify-type-provider-zod` and `@types/*` need the standard compiler; TS 7 native has no bearing on a Node service.

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2023"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Install dependencies**

Run: `cd /Users/emerson/Documents/workspace/hackathons/calledit-api && pnpm install`
Expected: lockfile written, no errors.

- [ ] **Step 4: Create `src/db/types.ts`**

```ts
export interface QueryResult<T> {
  rows: T[];
}

export interface Db {
  query<T = unknown>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}
```

- [ ] **Step 5: Create `src/config/env.ts`**

```ts
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  // Optional in milestone 1 — used by the feed ingester and settlement later.
  NETWORK: z.enum(['mainnet', 'devnet']).optional(),
  SOLANA_RPC_URL: z.string().optional(),
  TXORACLE_PROGRAM_ID: z.string().optional(),
  TXL_TOKEN_MINT: z.string().optional(),
  TXLINE_API_ORIGIN: z.string().optional(),
  TXLINE_JWT: z.string().optional(),
  TXLINE_API_TOKEN: z.string().optional(),
  SERVICE_WALLET_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  return parsed.data;
}
```

- [ ] **Step 6: Create `src/routes/health.ts`**

```ts
import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ status: 'ok' }));
}
```

- [ ] **Step 7: Create `src/app.ts`**

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { Db } from './db/types.js';
import { healthRoutes } from './routes/health.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
  }
}

export interface AppOptions {
  db: Db;
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate('db', opts.db);
  app.register(cors, { origin: true });
  app.register(healthRoutes);
  return app;
}
```

- [ ] **Step 8: Create `src/server.ts`**

```ts
import { Pool } from 'pg';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const pool = new Pool({ connectionString: env.DATABASE_URL });
const app = buildApp({ db: pool });

app
  .listen({ port: env.PORT, host: '0.0.0.0' })
  .then((address) => console.log(`calledit-api listening on ${address}`))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
```

- [ ] **Step 9: Create `.env.example`**

```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://user:pass@localhost:5432/calledit

# later milestones (feed + settlement) — leave blank in milestone 1
NETWORK=devnet
SOLANA_RPC_URL=
TXORACLE_PROGRAM_ID=
TXL_TOKEN_MINT=
TXLINE_API_ORIGIN=
TXLINE_JWT=
TXLINE_API_TOKEN=
SERVICE_WALLET_SECRET=
```

- [ ] **Step 10: Copy backend agents and MCP config**

Run:

```bash
cd /Users/emerson/Documents/workspace/hackathons/calledit-api
mkdir -p .claude/agents
for a in arq back bug qa redteam scribe; do cp ../called-it/.claude/agents/$a.md .claude/agents/$a.md; done
cp ../called-it/.mcp.json .mcp.json
ls .claude/agents/
```

Expected: `arq.md back.md bug.md qa.md redteam.md scribe.md`

(Agent text adaptation happens in Task 8 — copy verbatim now.)

- [ ] **Step 11: Write the failing test `test/health.test.ts`**

```ts
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
```

- [ ] **Step 12: Run the test**

Run: `pnpm test`
Expected: PASS (1 test).

- [ ] **Step 13: Commit**

```bash
git add package.json tsconfig.json .env.example src .claude .mcp.json test/health.test.ts pnpm-lock.yaml
git commit -m "bootstrap fastify service with health route"
```

---

### Task 2: Swagger UI with the Fastify logo removed

**Files:**

- Modify: `src/app.ts`
- Test: `test/docs.test.ts`

**Interfaces:**

- Consumes: `buildApp({ db })` from Task 1
- Produces: `/docs` (Swagger UI, topbar hidden) and `/docs/json` (OpenAPI document)

- [ ] **Step 1: Write the failing test `test/docs.test.ts`**

```ts
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
    const doc = res.json() as { openapi?: string; info?: { title?: string } };
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.info?.title).toBe('Called It API');
    await app.close();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm test test/docs.test.ts`
Expected: FAIL (404 at `/docs/json`).

- [ ] **Step 3: Update `src/app.ts` to register swagger with Zod type provider**

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Db } from './db/types.js';
import { healthRoutes } from './routes/health.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
  }
}

export interface AppOptions {
  db: Db;
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('db', opts.db);
  app.register(cors, { origin: true });

  app.register(swagger, {
    openapi: {
      info: { title: 'Called It API', version: '0.1.0' },
    },
    transform: jsonSchemaTransform,
  });
  app.register(swaggerUi, {
    routePrefix: '/docs',
    theme: {
      // Hide the Swagger/Fastify topbar logo — clean docs header.
      css: [{ filename: 'theme.css', content: '.swagger-ui .topbar { display: none }' }],
    },
  });

  app.register(healthRoutes);
  return app;
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm test test/docs.test.ts`
Expected: PASS.

- [ ] **Step 5: Manually verify the hidden topbar (optional)**

Run: `DATABASE_URL=postgres://x pnpm dev` then open `http://localhost:3000/docs` — the top green bar with the logo is gone. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add src/app.ts test/docs.test.ts
git commit -m "add swagger ui with topbar logo removed"
```

---

### Task 3: Zod DTO schemas mirroring the frontend contracts

**Files:**

- Create: `src/schemas/index.ts`
- Test: `test/schemas.test.ts`

**Interfaces:**

- Produces: `walletAccountSchema`, `matchSnapshotSchema`, `predictionSchema`, `profileSchema`, `leaderboardSchema`, `historySchema`, `fixturesSchema`, `walletOverviewSchema`, `commitPredictionSchema`, and inferred types `Prediction`, `CommitPredictionInput`.

- [ ] **Step 1: Create `src/schemas/index.ts` (verbatim mirror of the frontend + request bodies)**

```ts
import { z } from 'zod';

export const teamInfoSchema = z.object({
  code: z.string(),
  name: z.string(),
  flag: z.string(),
});

export const matchEventSchema = z.object({
  id: z.string(),
  type: z.enum(['goal', 'yellow', 'red', 'corner', 'foul', 'sub', 'var']),
  side: z.enum(['home', 'away']),
  clockMin: z.number(),
  player: z.string().optional(),
  detail: z.string().optional(),
});

export const matchSnapshotSchema = z.object({
  matchId: z.string(),
  clockMin: z.number(),
  period: z.enum(['1H', 'HT', '2H', 'ET', 'PENS', 'FT']),
  home: teamInfoSchema,
  away: teamInfoSchema,
  score: z.tuple([z.number(), z.number()]),
  pct: z.object({ home: z.number(), draw: z.number(), away: z.number() }),
  events: z.array(matchEventSchema),
  markets: z.array(z.object({ market: z.string(), multiplier: z.number() })),
  live: z.boolean(),
});

export const walletAccountSchema = z.object({
  address: z.string(),
  balanceSol: z.number(),
  chain: z.enum(['solana', 'evm']),
  provider: z.string(),
});

export const stampSchema = z.object({
  txHash: z.string(),
  stampedAt: z.number(),
  seq: z.number().int().min(1),
  epochDay: z.number().int(),
});

export const settlementSchema = z.object({
  proofId: z.string(),
  payoutSol: z.number(),
  calledSecondsBefore: z.number(),
  resolvedEvent: matchEventSchema.nullable(),
});

export const predictionSchema = z.object({
  id: z.string(),
  matchId: z.string(),
  market: z.enum(['corner', 'card', 'goal', 'foul']),
  provable: z.boolean(),
  stakeSol: z.number(),
  multiplier: z.number(),
  potentialSol: z.number(),
  atClockMin: z.number(),
  windowMin: z.number(),
  status: z.enum(['resolving', 'won', 'lost']),
  stamp: stampSchema,
  settlement: settlementSchema.optional(),
});

export const historySchema = z.object({ items: z.array(predictionSchema) });

export const walletActivitySchema = z.object({
  id: z.string(),
  type: z.enum(['deposit', 'withdraw', 'payout', 'stake']),
  amountSol: z.number(),
  fiatAmount: z.number().optional(),
  method: z.string().optional(),
  status: z.enum(['settled', 'pending']),
  ts: z.number(),
});

export const walletOverviewSchema = z.object({
  address: z.string(),
  balanceSol: z.number(),
  currency: z.string(),
  fiatRate: z.number(),
  activity: z.array(walletActivitySchema),
});

export const fixtureSchema = z.object({
  id: z.string(),
  home: teamInfoSchema,
  away: teamInfoSchema,
  kickoff: z.number(),
  stage: z.string(),
  venue: z.string(),
});

export const fixturesSchema = z.object({ items: z.array(fixtureSchema) });

export const profileSchema = z.object({
  address: z.string(),
  handle: z.string(),
  accuracy: z.number(),
  totalCalls: z.number(),
  wonCalls: z.number(),
  bestStreak: z.number(),
  currentStreak: z.number(),
  rank: z.number(),
  balanceSol: z.number(),
});

export const leaderboardSchema = z.object({
  entries: z.array(
    z.object({
      rank: z.number(),
      handle: z.string(),
      accuracy: z.number(),
      streak: z.number(),
      calls: z.number(),
      you: z.boolean(),
    }),
  ),
});

export const marketSchema = z.enum(['corner', 'card', 'goal', 'foul']);

export const commitPredictionSchema = z.object({
  matchId: z.string(),
  market: marketSchema,
  stakeSol: z.number().positive(),
  address: z.string(),
});

export type Market = z.infer<typeof marketSchema>;
export type Prediction = z.infer<typeof predictionSchema>;
export type CommitPredictionInput = z.infer<typeof commitPredictionSchema>;
export type ProfileDto = z.infer<typeof profileSchema>;
export type LeaderboardDto = z.infer<typeof leaderboardSchema>;
```

- [ ] **Step 2: Write the test `test/schemas.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { predictionSchema, commitPredictionSchema } from '../src/schemas/index.js';

describe('schemas', () => {
  it('accepts a valid prediction', () => {
    const valid = {
      id: 'p1',
      matchId: 'm1',
      market: 'goal',
      provable: true,
      stakeSol: 0.5,
      multiplier: 2,
      potentialSol: 1,
      atClockMin: 12,
      windowMin: 5,
      status: 'resolving',
      stamp: { txHash: 'stub-p1', stampedAt: 1, seq: 1, epochDay: 20000 },
    };
    expect(predictionSchema.parse(valid)).toBeTruthy();
  });

  it('rejects seq below 1', () => {
    const bad = {
      id: 'p1',
      matchId: 'm1',
      market: 'goal',
      provable: true,
      stakeSol: 0.5,
      multiplier: 2,
      potentialSol: 1,
      atClockMin: 12,
      windowMin: 5,
      status: 'resolving',
      stamp: { txHash: 'x', stampedAt: 1, seq: 0, epochDay: 20000 },
    };
    expect(() => predictionSchema.parse(bad)).toThrow();
  });

  it('rejects a non-positive stake in the request body', () => {
    expect(() =>
      commitPredictionSchema.parse({ matchId: 'm1', market: 'goal', stakeSol: 0, address: 'a' }),
    ).toThrow();
  });
});
```

- [ ] **Step 3: Run the test**

Run: `pnpm test test/schemas.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 4: Commit**

```bash
git add src/schemas/index.ts test/schemas.test.ts
git commit -m "mirror frontend zod contracts"
```

---

### Task 4: Market money helpers (provability, multiplier, payout)

**Files:**

- Create: `src/services/markets.ts`
- Test: `test/markets.test.ts`

**Interfaces:**

- Consumes: `Market` type from `src/schemas/index.js`
- Produces: `isProvable(market: Market): boolean`, `multiplierFor(market: Market): number`, `payout(stakeSol: number, multiplier: number): number`

- [ ] **Step 1: Write the failing test `test/markets.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { isProvable, multiplierFor, payout } from '../src/services/markets.js';

describe('markets', () => {
  it('marks goal/card/corner provable and foul not', () => {
    expect(isProvable('goal')).toBe(true);
    expect(isProvable('card')).toBe(true);
    expect(isProvable('corner')).toBe(true);
    expect(isProvable('foul')).toBe(false);
  });

  it('returns a positive multiplier per market', () => {
    expect(multiplierFor('goal')).toBeGreaterThan(1);
    expect(multiplierFor('foul')).toBeGreaterThan(1);
  });

  it('computes payout as stake times multiplier', () => {
    expect(payout(0.5, 2)).toBe(1);
    expect(payout(0.25, 1.6)).toBeCloseTo(0.4);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm test test/markets.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `src/services/markets.ts`**

```ts
import type { Market } from '../schemas/index.js';

// ponytail: milestone-1 stub economics — real multipliers come from the live feed in milestone 2.
const PROVABLE: Record<Market, boolean> = { goal: true, card: true, corner: true, foul: false };
const MULTIPLIER: Record<Market, number> = { goal: 2.0, card: 1.8, corner: 1.6, foul: 1.5 };

export function isProvable(market: Market): boolean {
  return PROVABLE[market];
}

export function multiplierFor(market: Market): number {
  return MULTIPLIER[market];
}

export function payout(stakeSol: number, multiplier: number): number {
  return stakeSol * multiplier;
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm test test/markets.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/markets.ts test/markets.test.ts
git commit -m "add market provability and payout helpers"
```

---

### Task 5: Database layer (schema, pool, migrate)

**Files:**

- Create: `src/db/schema.sql`, `src/db/migrate.ts`
- Test: `test/schema.test.ts`

**Interfaces:**

- Consumes: `Db` from `src/db/types.js`, `loadEnv` from `src/config/env.js`
- Produces: `runMigration(db: Db): Promise<void>` (in `src/db/migrate.ts`)

- [ ] **Step 1: Create `src/db/schema.sql`**

```sql
create table if not exists feed_events (
  id          bigserial primary key,
  fixture_id  text not null,
  seq         int  not null,
  kind        text not null,
  ts          timestamptz not null,
  payload     jsonb not null,
  unique (fixture_id, kind, seq)
);
create index if not exists feed_events_fixture_seq on feed_events (fixture_id, seq);

create table if not exists predictions (
  id            uuid primary key,
  address       text not null,
  match_id      text not null,
  market        text not null,
  provable      boolean not null,
  stake_sol     numeric not null,
  multiplier    numeric not null,
  potential_sol numeric not null,
  at_clock_min  int not null,
  window_min    int not null,
  status        text not null default 'resolving',
  tx_hash       text,
  stamped_at    bigint,
  seq           int,
  epoch_day     int,
  settlement    jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists predictions_address on predictions (address);
create index if not exists predictions_match on predictions (match_id);
```

- [ ] **Step 2: Create `src/db/migrate.ts`**

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Pool } from 'pg';
import type { Db } from './types.js';
import { loadEnv } from '../config/env.js';

const here = dirname(fileURLToPath(import.meta.url));

export async function runMigration(db: Db): Promise<void> {
  const sql = readFileSync(join(here, 'schema.sql'), 'utf8');
  await db.query(sql);
}

// Run directly: `pnpm migrate`
if (import.meta.url === `file://${process.argv[1]}`) {
  const env = loadEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  runMigration(pool)
    .then(() => {
      console.log('migration applied');
      return pool.end();
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
```

- [ ] **Step 3: Write the test `test/schema.test.ts`**

```ts
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
```

- [ ] **Step 4: Run the test**

Run: `pnpm test test/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.sql src/db/migrate.ts test/schema.test.ts
git commit -m "add postgres schema and migration runner"
```

---

### Task 6: Predictions routes (DB-backed)

**Files:**

- Create: `src/services/predictions.ts`, `src/routes/predictions.ts`
- Modify: `src/app.ts` (register `predictionRoutes`)
- Test: `test/predictions.test.ts`

**Interfaces:**

- Consumes: `Db`, schemas, `isProvable`/`multiplierFor`/`payout`
- Produces: `createPrediction(db, input)`, `getPredictionById(db, id)`, `listByAddress(db, address)` (in `src/services/predictions.ts`), each returning `Prediction`/`Prediction | null`/`Prediction[]`
- Produces routes: `POST /api/predictions`, `GET /api/predictions/:id`, `GET /api/predictions?address=`

- [ ] **Step 1: Create `src/services/predictions.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/types.js';
import type { CommitPredictionInput, Prediction } from '../schemas/index.js';
import { isProvable, multiplierFor, payout } from './markets.js';

interface PredictionRow {
  id: string;
  match_id: string;
  market: Prediction['market'];
  provable: boolean;
  stake_sol: string;
  multiplier: string;
  potential_sol: string;
  at_clock_min: number;
  window_min: number;
  status: Prediction['status'];
  tx_hash: string | null;
  stamped_at: string | null;
  seq: number | null;
  epoch_day: number | null;
  settlement: Prediction['settlement'] | null;
}

function rowToPrediction(row: PredictionRow): Prediction {
  return {
    id: row.id,
    matchId: row.match_id,
    market: row.market,
    provable: row.provable,
    stakeSol: Number(row.stake_sol),
    multiplier: Number(row.multiplier),
    potentialSol: Number(row.potential_sol),
    atClockMin: row.at_clock_min,
    windowMin: row.window_min,
    status: row.status,
    stamp: {
      txHash: row.tx_hash ?? '',
      stampedAt: Number(row.stamped_at ?? 0),
      seq: row.seq ?? 1,
      epochDay: row.epoch_day ?? 0,
    },
    ...(row.settlement ? { settlement: row.settlement } : {}),
  };
}

export async function createPrediction(db: Db, input: CommitPredictionInput): Promise<Prediction> {
  const id = randomUUID();
  const provable = isProvable(input.market);
  const multiplier = multiplierFor(input.market);
  const potentialSol = payout(input.stakeSol, multiplier);
  const atClockMin = 0;
  const windowMin = 5;
  // ponytail: milestone-1 stub stamp — replaced by the real on-chain stamp in milestone 3.
  const stampedAt = Date.now();
  const seq = 1;
  const epochDay = Math.floor(stampedAt / 86_400_000);
  const txHash = `stub-${id}`;

  await db.query(
    `insert into predictions
       (id, address, match_id, market, provable, stake_sol, multiplier, potential_sol,
        at_clock_min, window_min, status, tx_hash, stamped_at, seq, epoch_day)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'resolving',$11,$12,$13,$14)`,
    [
      id,
      input.address,
      input.matchId,
      input.market,
      provable,
      input.stakeSol,
      multiplier,
      potentialSol,
      atClockMin,
      windowMin,
      txHash,
      stampedAt,
      seq,
      epochDay,
    ],
  );

  return {
    id,
    matchId: input.matchId,
    market: input.market,
    provable,
    stakeSol: input.stakeSol,
    multiplier,
    potentialSol,
    atClockMin,
    windowMin,
    status: 'resolving',
    stamp: { txHash, stampedAt, seq, epochDay },
  };
}

export async function getPredictionById(db: Db, id: string): Promise<Prediction | null> {
  const { rows } = await db.query<PredictionRow>('select * from predictions where id = $1', [id]);
  return rows[0] ? rowToPrediction(rows[0]) : null;
}

export async function listByAddress(db: Db, address: string): Promise<Prediction[]> {
  const { rows } = await db.query<PredictionRow>(
    'select * from predictions where address = $1 order by created_at desc',
    [address],
  );
  return rows.map(rowToPrediction);
}
```

- [ ] **Step 2: Create `src/routes/predictions.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { commitPredictionSchema, historySchema, predictionSchema } from '../schemas/index.js';
import { createPrediction, getPredictionById, listByAddress } from '../services/predictions.js';

export async function predictionRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/api/predictions',
    { schema: { body: commitPredictionSchema, response: { 200: predictionSchema } } },
    async (req) => createPrediction(app.db, req.body),
  );

  r.get(
    '/api/predictions',
    {
      schema: { querystring: z.object({ address: z.string() }), response: { 200: historySchema } },
    },
    async (req) => ({ items: await listByAddress(app.db, req.query.address) }),
  );

  r.get(
    '/api/predictions/:id',
    { schema: { params: z.object({ id: z.string() }), response: { 200: predictionSchema } } },
    async (req, reply) => {
      const found = await getPredictionById(app.db, req.params.id);
      if (!found) return reply.code(404).send({ error: 'not_found' });
      return found;
    },
  );
}
```

- [ ] **Step 3: Register the routes in `src/app.ts`**

Add the import and registration (after `app.register(healthRoutes);`):

```ts
import { predictionRoutes } from './routes/predictions.js';
// ...
app.register(predictionRoutes);
```

- [ ] **Step 4: Write the test `test/predictions.test.ts`**

```ts
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
```

- [ ] **Step 5: Run the tests**

Run: `pnpm test test/predictions.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/services/predictions.ts src/routes/predictions.ts src/app.ts test/predictions.test.ts
git commit -m "add db-backed predictions routes"
```

---

### Task 7: Stub routes (wallet, feed, profile, leaderboard, fixtures)

**Files:**

- Create: `src/routes/stubs.ts`
- Modify: `src/app.ts` (register `stubRoutes`)
- Test: `test/stubs.test.ts`

**Interfaces:**

- Consumes: schemas from Task 3
- Produces routes: `POST /api/wallet/connect`, `GET /api/feed/:matchId`, `GET /api/me`, `GET /api/leaderboard`, `GET /api/fixtures/upcoming`, `GET /api/wallet`, `POST /api/wallet/deposit`, `POST /api/wallet/withdraw` — all returning valid-shaped stubs.

- [ ] **Step 1: Create `src/routes/stubs.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  fixturesSchema,
  leaderboardSchema,
  matchSnapshotSchema,
  profileSchema,
  walletAccountSchema,
  walletOverviewSchema,
} from '../schemas/index.js';

const BRA = { code: 'BRA', name: 'Brazil', flag: '🇧🇷' };
const ARG = { code: 'ARG', name: 'Argentina', flag: '🇦🇷' };

export async function stubRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/api/wallet/connect',
    {
      schema: { body: z.object({ provider: z.string() }), response: { 200: walletAccountSchema } },
    },
    async (req) => ({
      address: 'STUBwa11et',
      balanceSol: 12.5,
      chain: 'solana',
      provider: req.body.provider,
    }),
  );

  r.get(
    '/api/feed/:matchId',
    {
      schema: { params: z.object({ matchId: z.string() }), response: { 200: matchSnapshotSchema } },
    },
    async (req) => ({
      matchId: req.params.matchId,
      clockMin: 12,
      period: '1H',
      home: BRA,
      away: ARG,
      score: [1, 0] as [number, number],
      pct: { home: 0.55, draw: 0.25, away: 0.2 },
      events: [],
      markets: [
        { market: 'goal', multiplier: 2.0 },
        { market: 'corner', multiplier: 1.6 },
        { market: 'card', multiplier: 1.8 },
      ],
      live: true,
    }),
  );

  r.get(
    '/api/me',
    {
      schema: { querystring: z.object({ address: z.string() }), response: { 200: profileSchema } },
    },
    async (req) => ({
      address: req.query.address,
      handle: 'stubcaller',
      accuracy: 0.62,
      totalCalls: 21,
      wonCalls: 13,
      bestStreak: 4,
      currentStreak: 2,
      rank: 7,
      balanceSol: 12.5,
    }),
  );

  r.get(
    '/api/leaderboard',
    {
      schema: {
        querystring: z.object({ address: z.string() }),
        response: { 200: leaderboardSchema },
      },
    },
    async () => ({
      entries: [
        { rank: 1, handle: 'goalgod', accuracy: 0.81, streak: 6, calls: 40, you: false },
        { rank: 7, handle: 'stubcaller', accuracy: 0.62, streak: 2, calls: 21, you: true },
      ],
    }),
  );

  r.get('/api/fixtures/upcoming', { schema: { response: { 200: fixturesSchema } } }, async () => ({
    items: [
      {
        id: 'm1',
        home: BRA,
        away: ARG,
        kickoff: 1_752_000_000_000,
        stage: 'Group A',
        venue: 'MetLife',
      },
    ],
  }));

  const overview = (address: string) => ({
    address,
    balanceSol: 12.5,
    currency: 'SOL',
    fiatRate: 180,
    activity: [
      {
        id: 'a1',
        type: 'deposit' as const,
        amountSol: 5,
        status: 'settled' as const,
        ts: 1_751_000_000_000,
      },
    ],
  });

  r.get(
    '/api/wallet',
    {
      schema: {
        querystring: z.object({ address: z.string() }),
        response: { 200: walletOverviewSchema },
      },
    },
    async (req) => overview(req.query.address),
  );

  r.post(
    '/api/wallet/deposit',
    {
      schema: {
        body: z.object({ address: z.string(), amountSol: z.number() }),
        response: { 200: walletOverviewSchema },
      },
    },
    async (req) => overview(req.body.address),
  );

  r.post(
    '/api/wallet/withdraw',
    {
      schema: {
        body: z.object({ address: z.string(), amountSol: z.number(), method: z.string() }),
        response: { 200: walletOverviewSchema },
      },
    },
    async (req) => overview(req.body.address),
  );
}
```

- [ ] **Step 2: Register in `src/app.ts`**

Add import and registration after `app.register(predictionRoutes);`:

```ts
import { stubRoutes } from './routes/stubs.js';
// ...
app.register(stubRoutes);
```

- [ ] **Step 3: Write the test `test/stubs.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Db } from '../src/db/types.js';
import {
  fixturesSchema,
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

  it('GET /api/me, /api/leaderboard, /api/fixtures/upcoming, /api/wallet', async () => {
    const app = buildApp({ db: fakeDb });
    expect(() =>
      profileSchema.parse((await app.inject({ method: 'GET', url: '/api/me?address=a' })).json()),
    ).not.toThrow();
    expect(() =>
      leaderboardSchema.parse(
        (await app.inject({ method: 'GET', url: '/api/leaderboard?address=a' })).json(),
      ),
    ).not.toThrow();
    expect(() =>
      fixturesSchema.parse(
        (await app.inject({ method: 'GET', url: '/api/fixtures/upcoming' })).json(),
      ),
    ).not.toThrow();
    expect(() =>
      walletOverviewSchema.parse(
        (await app.inject({ method: 'GET', url: '/api/wallet?address=a' })).json(),
      ),
    ).not.toThrow();
    await app.close();
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test test/stubs.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full suite + type-check**

Run: `pnpm test && pnpm type-check`
Expected: all tests PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/stubs.ts src/app.ts test/stubs.test.ts
git commit -m "add valid-shaped stub routes for remaining seams"
```

---

### Task 8: Render deploy config, agent adaptation, README

**Files:**

- Create: `render.yaml`, `README.md`
- Modify: `.claude/agents/{arq,back,bug,qa,redteam,scribe}.md` (backend framing)

**Interfaces:** none (config + docs).

- [ ] **Step 1: Create `render.yaml`**

```yaml
services:
  - type: web
    name: calledit-api
    runtime: node
    plan: starter
    buildCommand: pnpm install && pnpm build
    startCommand: pnpm migrate && pnpm start
    healthCheckPath: /health
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: calledit-db
          property: connectionString
      - key: NODE_ENV
        value: production
databases:
  - name: calledit-db
    plan: free
```

- [ ] **Step 2: Create `README.md`**

````markdown
# calledit-api

Backend for **Called It** — Fastify + Postgres. Serves the frontend seams; feed ingester and on-chain
settlement land in later milestones (see `docs/superpowers/specs/`).

## Run locally

```bash
pnpm install
cp .env.example .env      # set DATABASE_URL
pnpm migrate              # apply schema
pnpm dev                  # http://localhost:3000  ·  docs at /docs
```

## Scripts

`pnpm dev` · `pnpm build` · `pnpm start` · `pnpm migrate` · `pnpm test` · `pnpm type-check`

## Deploy (Render)

Push to a Render Blueprint using `render.yaml` — provisions the web service (Starter) + Postgres (free)
and wires `DATABASE_URL`. The start command runs the migration then boots the server.
````

- [ ] **Step 3: Adapt each agent file to backend framing**

For each of `arq, back, bug, qa, redteam, scribe` in `.claude/agents/`, edit the description/body so it targets this service. Concretely:

- Replace mentions of "PWA / React / Vite / frontend / 60fps / Playwright" with "Fastify API / Postgres / Solana / TxLINE feed".
- `qa.md`: reframe from "on-screen E2E (Playwright)" to "integration + contract tests (`fastify.inject`, Zod)".
- `bug.md`: keep as the quality gate but for Node/Fastify/SQL/web3 code.
- `redteam.md`: focus on API auth, key handling, feed/oracle manipulation, replay/seq.
- Keep `arq.md` and `back.md` largely intact (already backend-oriented); trim frontend-only lines.

Make the edits with the editor (no scripted find/replace — read each file and adjust its top description line + any frontend-only bullet).

- [ ] **Step 4: Verify the build and full suite one more time**

Run: `pnpm install && pnpm type-check && pnpm test`
Expected: install clean, no type errors, all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add render.yaml README.md .claude/agents
git commit -m "add render blueprint, readme and backend-framed agents"
```

---

## Self-Review

**Spec coverage:**

- §3 infra (Render) → Task 8 `render.yaml`. ✓
- §4 stack → Task 1 deps. ✓
- §5 structure → Tasks 1–7 create the files. ✓
- §6 data model (2 tables) → Task 5 `schema.sql`. ✓
- §7 six seams + extras + `/health` + `/docs` → Tasks 1, 2, 6, 7. ✓
- §8 error handling / Zod validation / env fail-fast → Task 1 env, Zod validation on every route (Tasks 6–7), 404 handling (Task 6). ✓
- §9 milestone 1 (stubbed stamp, `status: resolving`) → Task 6 `createPrediction`. ✓
- §10 testing (money logic unit + contract via inject) → Task 4 + Tasks 6–7. ✓
- §11 agents migration → Task 1 (copy) + Task 8 (adapt). ✓
- §12 env/secrets → Task 1 `env.ts` + `.env.example`. ✓

**Placeholder scan:** no TBD/TODO; every code step has full code. ✓
**Type consistency:** `Db.query` signature, `buildApp({ db })`, `createPrediction/getPredictionById/listByAddress`, and `isProvable/multiplierFor/payout` names match across tasks. ✓
