# calledit-api

Backend for **Called It** — a live, on-chain-verified World Cup 2026 prediction PWA on Solana.

This service replaces MSW at the frontend's network boundary: it serves the same REST seams the
frontend already validates with Zod, ingests the real TxODDS **TxLINE** feed over SSE, and (prize
feature, in progress) settles provable predictions with a CPI into the on-chain `txoracle` program.

> Design doc: [`docs/superpowers/specs/2026-07-18-backend-api-design.md`](docs/superpowers/specs/2026-07-18-backend-api-design.md)
> Milestone plans: [`docs/superpowers/plans/`](docs/superpowers/plans/)
> Devnet credential setup: [`docs/devnet-setup-guide.html`](docs/devnet-setup-guide.html)

## 1. What it is

- **Domain**: users commit a prediction (`goal`, `card`, `corner`, or `foul`) on a live match before
  the event happens; the call is stamped, and — for the three *provable* markets — later verified
  against the match's on-chain Merkle result.
- **Role in the system**: the single network boundary. The frontend's `shared/api` client talks to
  this service instead of MSW; this service is the only thing that talks to Postgres, the TxLINE
  feed, and (eventually) Solana.
- **Built in milestones**: milestone 1 shipped the API skeleton with DB-backed predictions and
  valid-shaped stubs for the rest; milestone 2 replaced the feed stub with a real SSE ingester and
  projector; milestone 3 (in progress) adds on-chain settlement.

## 2. Architecture

One Node/TypeScript (ESM) **Fastify** service in front of **Postgres**. No separate worker process —
the SSE ingester that records the live feed runs inside the same process as the HTTP server, started
only when TxLINE credentials are present in the environment.

```
                    ┌─────────────────────────────────────────────┐
                    │              calledit-api (Fastify)          │
  Called It PWA ───▶│  routes → Zod validate → services → OpenAPI  │
  (frontend)   ◀────│                    │                         │
                    │                    ▼                         │
                    │              app.db: Db  ───────────────────┼───▶ Postgres
                    │                                              │    (feed_events, predictions)
                    │  SSE ingester (same process, env-guarded) ───┼───▶ TxLINE feed (SSE, TxODDS)
                    │                                              │
                    │  settlement (milestone 3, CPI) ──────────────┼───▶ Solana / txoracle program
                    └─────────────────────────────────────────────┘
```

Key design points:

- **Request flow**: every route declares its `body`/`querystring`/`params`/`response` as Zod schemas
  (`src/schemas/index.ts`). `fastify-type-provider-zod` validates the request, infers TypeScript types
  for the handler, and serializes the response — the same schemas double as the OpenAPI source
  (`@fastify/swagger` + `jsonSchemaTransform`), served live at `/docs`. A schema mismatch fails fast
  as a `400`, not a silent contract drift with the frontend.
- **Injectable `Db`**: `buildApp({ db })` (`src/app.ts`) takes anything satisfying
  `interface Db { query<T>(text, params?): Promise<{ rows: T[] }> }` (`src/db/types.ts`). Production
  wires a `pg.Pool`; tests wire an in-memory fake — no real Postgres needed to exercise a route.
- **SSE ingester in-process**: `src/server.ts` starts `startIngester()` after the HTTP listener is up,
  but only if `TXLINE_API_ORIGIN` and `TXLINE_API_TOKEN` are set — the app boots and serves stubs fine
  without TxLINE credentials (milestone 1 behavior is preserved).

## 3. Project structure

```
src/
├── app.ts                # buildApp({ db }): fastify instance, cors, swagger/zod type-provider, route registration
├── server.ts              # composition root: loads env, opens the pg pool, listens, starts the ingester
├── config/
│   └── env.ts              # Zod-validated env — fails fast on boot if required vars are missing
├── db/
│   ├── types.ts             # the injectable Db interface (testability seam)
│   ├── schema.sql            # feed_events + predictions tables
│   └── migrate.ts             # runMigration(db); `pnpm migrate` applies schema.sql
├── schemas/
│   └── index.ts              # Zod DTOs mirroring the frontend's shared/api/schemas.ts, 1:1
├── routes/
│   ├── health.ts              # GET /health
│   ├── predictions.ts          # POST/GET /api/predictions — DB-backed
│   ├── feed.ts                  # GET /api/feed/:matchId — DB-backed (milestone 2)
│   └── stubs.ts                   # wallet/profile/leaderboard/fixtures — valid-shaped stubs
├── services/
│   ├── markets.ts               # isProvable / multiplierFor / payout — the money rules
│   ├── predictions.ts            # createPrediction / getPredictionById / listByAddress
│   ├── feed.ts                    # getFeedSnapshot: reads feed_events, normalizes, projects
│   └── projector.ts                # projectSnapshot: pure fold of normalized events → MatchSnapshot
├── txline/
│   ├── auth.ts                     # fetchGuestJwt(origin) — POST /auth/guest/start
│   ├── client.ts                     # streamEvents: SSE loop, capped backoff, 401-renew circuit breaker
│   ├── sse.ts                         # parseSseChunk: pure, CRLF-safe SSE record parser
│   ├── normalize.ts                    # raw TxLINE payload → NormalizedScoreEvent/NormalizedOddsEvent
│   └── types.ts                         # normalized shapes shared by normalize/projector
├── ingester/
│   ├── index.ts                       # startIngester(db, config): wires both streams to the recorder
│   └── recorder.ts                     # recordRawEvent: idempotent insert into feed_events
└── settlement/
    └── keys.ts                        # statKeysFor: the 8 provable TxLINE keys × period, market → keys[]
```

`test/` mirrors `src/` with one Vitest file per module. `scripts/` holds one-off Solana/devnet
tooling (`fetch-idl.ts`, `bootstrap.ts`) that is not part of the runtime service.

## 4. The feed pipeline

1. **Auth** (`src/txline/auth.ts`): a guest JWT is fetched from TxLINE (`POST /auth/guest/start`);
   requests to the stream endpoints also carry a static `apiToken` (`X-Api-Token` header) obtained
   once via the devnet bootstrap flow (see §7).
2. **Ingestion** (`src/txline/client.ts` + `src/ingester/`): `startIngester` opens two long-lived SSE
   connections — `/api/scores/stream` and `/api/odds/stream` — using a shared JWT holder. The SSE
   client (`streamEvents`) auto-reconnects on network errors with capped exponential backoff, and on a
   `401` re-fetches the JWT with the same backoff, tripping a hard circuit breaker after 5 consecutive
   401s (bad credentials fail loud instead of hammering the auth endpoint forever).
3. **Recording** (`src/ingester/recorder.ts`): every normalized event is written to `feed_events` —
   this table is the **system of record** for the raw feed (TxLINE trap #2: record early, project
   later). The insert is `on conflict (fixture_id, kind, seq) do nothing`, so an SSE reconnect replaying
   history is a no-op rather than a duplicate or an error.
4. **Projection** (`src/services/projector.ts`): `projectSnapshot` is a pure function that folds the
   ordered `score` and `odds` events for a fixture into a single `MatchSnapshot` — diffing cumulative
   goals/cards/corners between consecutive score events into discrete `MatchEvent`s, and taking the
   latest odds event for `pct` and `markets`. **Markets are discovered from the payload**
   (`PriceNames`/`Prices` arrays), never hardcoded (trap #3).
5. **Serving** (`src/services/feed.ts` + `src/routes/feed.ts`): `GET /api/feed/:matchId` reads
   `feed_events` for that fixture, normalizes, and projects on every request — no separate cache layer
   yet. An empty event history returns a valid, zeroed `MatchSnapshot` rather than a 404.

Two fields are documented placeholders until real TxLINE payloads are seen: the raw field-name casing
assumed by `normalize.ts`, and `clockMin` (hardcoded to `0` — the documented feed shape carries no
match clock). Both are marked `// verify against live sample` / `// ponytail:` in the code.

## 5. Settlement (on-chain)

Only **goal**, **card**, and **corner** are provable — each backed by a pair of TxLINE Merkle-provable
stat keys (`[teamHome, teamAway]`). `foul` is `provable: false` and is never routed to settlement.

`src/settlement/keys.ts` maps a market and match period to the full TxLINE stat keys:

```ts
statKeysFor(market: Market, period: Period): number[]
// e.g. team-1 first-half goals → base key 1 + period prefix 1000 → key 1001
```

| Market   | Base keys `[home, away]` |
| -------- | ------------------------- |
| `goal`   | `[1, 2]`                   |
| `card`   | `[3, 4]` (yellow-card keys) |
| `corner` | `[7, 8]`                    |

Period prefixes (`1H`/`HT` → `1000`, `2H` → `3000`, `ET` → `4000`, `PENS` → `6000`, `FT` → `0`) mirror
the frontend's `entities/match/periods.ts` exactly, including collapsing all extra-time sub-periods
into one `ET` bucket.

The rest of the settlement pipeline (design in
[`docs/superpowers/plans/2026-07-18-backend-api-milestone-3.md`](docs/superpowers/plans/2026-07-18-backend-api-milestone-3.md)):

1. **Proof fetch** — `GET /api/scores/stat-validation-v3?fixtureId=&seq=&statKeys=` against TxLINE,
   returning the `stat-validation-v3` Merkle proof for the market × period. `epochDay` is derived from
   the proof's own `ts`, never `Date.now()` (trap #4).
2. **Predicate** — evaluate the proof against the prediction's threshold via
   `program.methods.validateStat(...)`. A `.view()` simulation fallback works without a deployed
   program of our own; the prize feature is the **real CPI** transaction into the `txoracle` program
   (`validate_stat`) that actually releases a points-based pot on the boolean result.
3. **Resolution** — flip the prediction to `won`/`lost`, persist `settlement { proofId, payoutSol,
   calledSecondsBefore, resolvedEvent }`, already polled by the frontend via `GET /api/predictions/:id`.

**Status**: the key-mapping layer (`settlement/keys.ts`) is built and unit-tested; the proof-fetch,
predicate, and real-CPI transaction are in progress — blocked on the `txoracle` Anchor IDL
(`idl/txoracle.json`, fetched via `scripts/fetch-idl.ts`) and a funded devnet service wallet. Real-money
escrow is explicitly out of scope for the hackathon (requires licensing) — settlement pays out
points/free-to-play only.

## 6. API endpoints

All request/response bodies are Zod-validated; the same schemas generate the OpenAPI document at
`/docs/json` and the UI at `/docs`.

| Method | Path                       | Purpose                                                         | Backing        |
| ------ | -------------------------- | ---------------------------------------------------------------- | -------------- |
| GET    | `/health`                  | Liveness probe (used by Render's health check)                   | —              |
| GET    | `/docs`, `/docs/json`      | Swagger UI / raw OpenAPI document                                 | —              |
| POST   | `/api/predictions`         | Commit a prediction; returns a `Prediction` with `stamp`           | DB             |
| GET    | `/api/predictions/:id`     | Fetch one prediction (poll until `status` is `won`/`lost`)          | DB             |
| GET    | `/api/predictions?address=`| List a wallet's prediction history                                   | DB             |
| GET    | `/api/feed/:matchId`       | Live `MatchSnapshot` for a fixture — score, clock, odds, markets       | DB (real feed) |
| POST   | `/api/wallet/connect`      | Connect a wallet, returns a `WalletAccount`                             | stub           |
| GET    | `/api/wallet?address=`     | Wallet balance + activity overview                                       | stub           |
| POST   | `/api/wallet/deposit`      | Simulate a deposit, returns the updated overview                          | stub           |
| POST   | `/api/wallet/withdraw`     | Simulate a withdrawal, returns the updated overview                        | stub           |
| GET    | `/api/me?address=`         | Caller profile (accuracy, streaks, rank)                                    | stub           |
| GET    | `/api/leaderboard?address=`| Global leaderboard, with the caller's own entry flagged                      | stub           |
| GET    | `/api/fixtures/upcoming`   | Upcoming match fixtures                                                       | stub           |

"Stub" means the route returns data that always parses against its Zod contract (so the frontend can
build against it truthfully), but the values are not read from a real backing source yet — planned for
a later milestone (§9 of the design doc, "swap: replace each stub with the real service").

## 7. Local development

```bash
pnpm install
docker compose up -d      # starts local Postgres (calledit/calledit @ :5432)
pnpm migrate               # applies src/db/schema.sql
pnpm dev                    # http://localhost:3000  ·  docs at /docs
```

`pnpm dev` boots the API even with an empty `.env` beyond `DATABASE_URL` — the SSE ingester simply
stays disabled until TxLINE credentials are present.

To exercise the **real feed** and, later, **settlement**, you need devnet credentials:

1. Fund the devnet service wallet with devnet SOL (faucet — see
   [`docs/devnet-setup-guide.html`](docs/devnet-setup-guide.html) §1). The subscription that grants
   TxLINE access is itself an on-chain transaction, so the wallet needs SOL even on the free tier.
2. Run the bootstrap script to fetch a guest JWT, submit the on-chain `subscribe` call, activate an
   API token, and write the result to `.env`:
   ```bash
   tsx scripts/bootstrap.ts
   ```
   It writes `.env` (or `.env.bootstrap` if `.env` already exists, to avoid clobbering it) with
   `NETWORK`, `SOLANA_RPC_URL`, `TXORACLE_PROGRAM_ID`, `TXL_TOKEN_MINT`, `TXLINE_API_ORIGIN`,
   `TXLINE_JWT`, `TXLINE_API_TOKEN`, and `SERVICE_WALLET_SECRET` filled in for devnet.
3. `pnpm dev` again — the ingester now connects to the real TxLINE devnet feed.

### Environment variables (`.env.example`)

| Variable                | Required        | Notes                                                            |
| ------------------------ | ---------------- | ------------------------------------------------------------------ |
| `NODE_ENV`                | no (default `development`) |                                                        |
| `PORT`                     | no (default `3000`)         |                                                        |
| `DATABASE_URL`              | **yes**                      | Postgres connection string                            |
| `NETWORK`                    | no                             | `mainnet` \| `devnet` — never mix credentials across networks |
| `SOLANA_RPC_URL`               | no (feed/settlement only)       | RPC endpoint for the selected network                  |
| `TXORACLE_PROGRAM_ID`            | no (settlement only)             | on-chain `txoracle` program address                     |
| `TXL_TOKEN_MINT`                   | no (settlement only)              | TxL token mint for the selected network                  |
| `TXLINE_API_ORIGIN`                  | no (feed only)                     | TxLINE API host                                            |
| `TXLINE_JWT`                          | no (feed only)                      | seed JWT; the ingester re-fetches on expiry                 |
| `TXLINE_API_TOKEN`                     | no (feed only)                       | static per-subscription API token                             |
| `SERVICE_WALLET_SECRET`                  | no (settlement only)                  | path to the service wallet keypair — **never committed**       |

All secrets live only in `.env` (gitignored) or the Render dashboard — never in code or commit
history.

## 8. Scripts

| Script                | Command                     | Purpose                                                        |
| ---------------------- | ---------------------------- | ---------------------------------------------------------------- |
| `dev`                    | `tsx watch src/server.ts`      | run the API with hot reload                                      |
| `build`                   | `tsc`                            | compile `src/` to `dist/`                                         |
| `start`                    | `node dist/server.js`             | run the compiled build (used in production/Render)                  |
| `migrate`                   | `tsx src/db/migrate.ts`            | apply `src/db/schema.sql` to `DATABASE_URL`                          |
| `test`                        | `vitest run`                         | run the Vitest suite once                                              |
| `type-check`                    | `tsc --noEmit`                         | strict type-check without emitting                                       |
| `lint` / `lint:fix`                | `eslint .`                               | lint (and auto-fix) `src`/`test`/`scripts`                                |
| `format` / `format:check`            | `prettier --write .` / `--check .`         | format / verify formatting                                                  |

Two standalone helper scripts (not wired to `package.json`, run directly with `tsx`):

- `scripts/fetch-idl.ts` — fetches the published `txoracle` Anchor IDL from devnet and writes it to
  `idl/txoracle.json`, listing every instruction (used to confirm `validate_stat`'s exact signature
  before building the real CPI).
- `scripts/bootstrap.ts` — the one-time devnet credential flow described in §7: guest JWT → on-chain
  `subscribe` → token activation → writes `.env`.

## 9. Testing

**Vitest**, 40 tests across 13 files, all passing without a real Postgres connection — every test
wires a fake `Db` (`{ query: async () => ({ rows: [...] }) }`) instead. Two kinds of coverage:

- **Unit tests** on pure logic where a bug costs value: money rules (`markets.test.ts`), the
  settlement key mapping (`keys.test.ts`), the feed projector's event-diffing (`projector.test.ts`),
  the SSE record parser (`sse.test.ts`), and the TxLINE client's 401-renew/backoff/circuit-breaker
  behavior (`client.test.ts`, using an injected fake `fetch` and `wait` — no real network or timers).
- **Contract tests** hit every route in-process with `fastify.inject(...)` and assert the JSON
  response parses against the same Zod schema the frontend uses — this is what guarantees contract
  fidelity between backend and frontend without spinning up a browser or a real server.

```bash
pnpm test              # run once
pnpm test -- --watch    # watch mode
```

## 10. Deploy

Render Blueprint (`render.yaml`):

- **Web service** (`calledit-api`, Node runtime, **Starter plan**, not the free/sleeping tier — the
  SSE ingester needs a continuously running process to keep the feed connection alive).
  Build: `pnpm install && pnpm build`. Start: `pnpm migrate && pnpm start` (migration runs on every
  deploy before the server boots). Health check: `GET /health`.
- **Postgres** (`calledit-db`, free plan — expires after ~90 days, acceptable for the hackathon
  window). `DATABASE_URL` is wired automatically from the database's connection string.

```bash
# via the Render dashboard: New → Blueprint → point at this repo → render.yaml is auto-detected
```

## 11. Networks

TxLINE and `txoracle` exist on two networks; **never mix credentials or program IDs across them** —
doing so gets a `403` from the TxLINE API.

| | Devnet (build & test) | Mainnet SL 12 (live World Cup feed) |
| --- | --- | --- |
| Purpose | free devnet SOL, prove the on-chain path works | the actual real-time World Cup 2026 feed |
| `txoracle` program ID | `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` | `9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA` |
| TxL mint | `4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG` | `Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL` |
| TxLINE API host | `https://txline-dev.txodds.com` | `https://txline.txodds.com` |
| Solana RPC | `https://api.devnet.solana.com` | `https://api.mainnet-beta.solana.com` |
| Service level | 1 (proves the on-chain path) | 12 (real-time — the live demo) |

The service-level subscription itself is an on-chain transaction, so **SOL is required even on the
free tier** — devnet SOL is free via faucet; mainnet needs a small amount of real SOL to cover fees.

## 12. Code standards

- **TypeScript strict** (`tsconfig.json`: `strict`, `noUnusedLocals`, `noUnusedParameters`,
  `noFallthroughCasesInSwitch`), ESM-only (`"type": "module"`, `verbatimModuleSyntax`).
- **No `as` casts, no `!` non-null assertions, no `any`** — narrow `unknown` with explicit type
  guards (see `src/txline/normalize.ts` for the pattern used throughout the feed layer).
- Comments only where they carry non-obvious *why* (a money rule, a TxLINE trap, a documented guess
  pending real data) — never comments that narrate what the code already says. Deliberate
  simplifications are marked `// ponytail: ...` with the upgrade condition named inline.
- Commits: English, short imperative, lowercase, no trailing period, no AI/tooling attribution.
