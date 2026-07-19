# calledit-api

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Node](https://img.shields.io/badge/Node-20%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?style=for-the-badge&logo=fastify&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Solana](https://img.shields.io/badge/Solana-devnet-14F195?style=for-the-badge&logo=solana&logoColor=black)
![Anchor](https://img.shields.io/badge/Anchor-0.32-663399?style=for-the-badge)
![Zod](https://img.shields.io/badge/Zod-validated-3E67B1?style=for-the-badge)
![Vitest](https://img.shields.io/badge/Vitest-43%20passing-brightgreen?style=for-the-badge&logo=vitest&logoColor=white)
![Track](https://img.shields.io/badge/Superteam%20%C3%97%20TxODDS-World%20Cup-B6FF3C?style=for-the-badge)
![Status](https://img.shields.io/badge/status-devnet%20live-success?style=for-the-badge)

Backend for **Called It** — a live, on-chain-verified World Cup 2026 prediction game on Solana. You
commit a prediction *before* the event; this service stamps it, ingests the real TxODDS **TxLINE**
feed over SSE, and settles provable predictions with a CPI into the on-chain `txoracle` program. It
is the single network boundary that replaces MSW at the frontend: real Postgres, a real live feed, a
real on-chain subscribe — settlement CPI is the one piece still in flight.

> Design doc: [`docs/superpowers/specs/2026-07-18-backend-api-design.md`](docs/superpowers/specs/2026-07-18-backend-api-design.md)
> Milestone plans: [`docs/superpowers/plans/`](docs/superpowers/plans/)
> Devnet credential setup: [`docs/devnet-setup-guide.html`](docs/devnet-setup-guide.html)

## Quickstart for judges

**`pnpm <script>` currently fails a dependency-verification check in some sandboxed shells — run the
binaries directly with `./node_modules/.bin/...` as shown below, it always works.**

### Tier 1 — running API in 60 seconds (no credentials needed)

```bash
pnpm install
docker compose up -d                                  # local Postgres on :5432
DATABASE_URL=postgres://calledit:calledit@localhost:5432/calledit \
  ./node_modules/.bin/tsx src/db/migrate.ts            # (or: pnpm migrate)
DATABASE_URL=postgres://calledit:calledit@localhost:5432/calledit \
  ./node_modules/.bin/tsx src/server.ts
```

→ API at **http://localhost:3000** · **Swagger UI at http://localhost:3000/docs** · health at
`/health`.

**Without TxLINE credentials the app still boots fully.** Predictions persist to a real Postgres
database; the feed/wallet/profile/leaderboard/fixtures routes serve valid-shaped data — only the SSE
ingester is disabled (you'll see `ingester disabled (no TxLINE credentials)` in the log). Every route
is live and evaluable immediately.

Example calls (verified against the running server above):

```bash
curl -X POST http://localhost:3000/api/predictions \
  -H 'content-type: application/json' \
  -d '{"matchId":"wc-bra-arg","market":"goal","stakeSol":0.5,"address":"demoWallet123"}'
```

```json
{
  "id": "a16d7d6f-0119-47f8-9411-d33b12ec7a3e",
  "matchId": "wc-bra-arg",
  "market": "goal",
  "provable": true,
  "stakeSol": 0.5,
  "multiplier": 2,
  "potentialSol": 1,
  "atClockMin": 0,
  "windowMin": 5,
  "status": "resolving",
  "stamp": { "txHash": "stub-a16d7d6f-...", "stampedAt": 1784419583556, "seq": 1, "epochDay": 20653 }
}
```

```bash
curl http://localhost:3000/api/predictions/a16d7d6f-0119-47f8-9411-d33b12ec7a3e
# → same Prediction shape, polled until status flips to won/lost
```

### Tier 2 — full live devnet feed (optional)

1. Fund the devnet service wallet with devnet SOL — the TxLINE subscription is itself an on-chain
   transaction, so SOL is required even on the free tier (faucet instructions in the guide below).
2. `./node_modules/.bin/tsx scripts/bootstrap.ts` — fetches a guest JWT, submits the on-chain
   `subscribe` call, activates an API token, and writes the result to `.env`.
3. Start the server again — the ingester now connects to the **real TxLINE devnet SSE feed**.

A real devnet `subscribe` has already been run this way — the on-chain path is proven, not
theoretical. Full walkthrough: [`docs/devnet-setup-guide.html`](docs/devnet-setup-guide.html).

## What's real vs mocked

- ✅ **Real Postgres** — predictions and feed events are persisted, not in-memory.
- ✅ **Real TxLINE feed integration** — SSE client, JWT auth/renewal, backoff, circuit breaker (unit-tested against an injected fake `fetch`).
- ✅ **Real on-chain subscribe/activate on devnet** — already executed once via `scripts/bootstrap.ts`; the IDL (`idl/txoracle.json`) is fetched and versioned.
- ✅ **Authenticated, contract-tested API** — every route is exercised with `fastify.inject` against the same Zod schema the frontend uses.
- 🚧 **Settlement CPI** — the stat-key mapping (`src/settlement/keys.ts`) is built and unit-tested; the proof-fetch + `validate_stat` CPI transaction into `txoracle` is in progress. Toolchain (IDL, funded wallet, Anchor client) is ready.

## Architecture

```mermaid
flowchart LR
  FE["Called It PWA<br/>(React frontend)"]

  subgraph API["calledit-api (Fastify)"]
    ROUTES["routes<br/>predictions / feed / fixtures / wallet / profile"]
    ZOD["Zod validation<br/>+ OpenAPI / Swagger"]
    ING["SSE ingester"]
    PROJ["projector"]
    SET["settlement"]
  end

  DB[("Postgres<br/>feed_events, predictions")]

  subgraph EXT["External"]
    TXLINE["TxLINE feed<br/>(TxODDS)"]
    SOL["Solana / txoracle program"]
  end

  FE -- HTTP --> ROUTES
  ROUTES --> ZOD
  ROUTES -- SQL --> DB
  ING -- SSE --> TXLINE
  ING -- "writes" --> DB
  PROJ -- "reads" --> DB
  SET -- "RPC / CPI" --> SOL
```

```mermaid
sequenceDiagram
  participant U as Caller (wallet)
  participant API as calledit-api
  participant DB as Postgres
  participant TL as TxLINE feed
  participant SOL as txoracle (Solana)

  U->>API: POST /api/predictions
  API->>DB: insert prediction (status=resolving)
  API-->>U: Prediction + stamp (seq, epochDay)
  TL-->>API: SSE score/odds events
  API->>DB: record feed_events
  U->>API: GET /api/predictions/:id (poll)
  API->>SOL: validate_stat CPI (proof, threshold)
  SOL-->>API: won / lost
  API->>DB: update settlement
  API-->>U: Prediction (status=won/lost, settlement)
```

## Project structure

```
src/
├── app.ts                # buildApp({ db }): fastify instance, cors, swagger/zod type-provider, route registration
├── server.ts              # composition root: loads env, opens the pg pool, listens, starts the ingester
├── config/
│   └── env.ts              # Zod-validated env — fails fast on boot if required vars are missing
├── db/
│   ├── types.ts             # the injectable Db interface (testability seam)
│   ├── schema.sql            # feed_events + predictions tables
│   └── migrate.ts             # runMigration(db); tsx src/db/migrate.ts applies schema.sql
├── schemas/
│   └── index.ts              # Zod DTOs mirroring the frontend's shared/api/schemas.ts, 1:1
├── routes/
│   ├── health.ts              # GET /health
│   ├── predictions.ts          # POST/GET /api/predictions — DB-backed
│   ├── feed.ts                  # GET /api/feed/:matchId — DB-backed (milestone 2)
│   ├── fixtures.ts               # GET /api/fixtures/upcoming
│   └── stubs.ts                    # wallet/profile/leaderboard — valid-shaped stubs
├── services/
│   ├── markets.ts               # isProvable / multiplierFor / payout — the money rules
│   ├── predictions.ts            # createPrediction / getPredictionById / listByAddress
│   ├── feed.ts                    # getFeedSnapshot: reads feed_events, normalizes, projects
│   ├── fixtures.ts                 # getUpcomingFixtures
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

## The feed pipeline

1. **Auth** (`src/txline/auth.ts`): a guest JWT is fetched from TxLINE (`POST /auth/guest/start`);
   requests to the stream endpoints also carry a static `apiToken` (`X-Api-Token` header) obtained
   once via the devnet bootstrap flow (see Tier 2 above).
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

## Settlement (on-chain)

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
predicate, and real-CPI transaction are in progress. The `txoracle` Anchor IDL is already fetched
(`idl/txoracle.json`, via `scripts/fetch-idl.ts`) and a devnet service wallet is funded and has
already subscribed on-chain — the remaining work is wiring the CPI call itself. Real-money escrow is
explicitly out of scope for the hackathon (requires licensing) — settlement pays out points/free-to-play
only.

## API endpoints

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
| GET    | `/api/fixtures/upcoming`   | Upcoming World Cup fixtures                                              | stub           |
| POST   | `/api/wallet/connect`      | Connect a wallet, returns a `WalletAccount`                             | stub           |
| GET    | `/api/wallet?address=`     | Wallet balance + activity overview                                       | stub           |
| POST   | `/api/wallet/deposit`      | Simulate a deposit, returns the updated overview                          | stub           |
| POST   | `/api/wallet/withdraw`     | Simulate a withdrawal, returns the updated overview                        | stub           |
| GET    | `/api/me?address=`         | Caller profile (accuracy, streaks, rank)                                    | stub           |
| GET    | `/api/leaderboard?address=`| Global leaderboard, with the caller's own entry flagged                      | stub           |

"Stub" means the route returns data that always parses against its Zod contract (so the frontend can
build against it truthfully), but the values are not read from a real backing source yet — planned for
a later milestone (§9 of the design doc, "swap: replace each stub with the real service").

## Environment variables (`.env.example`)

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

## Scripts

`pnpm <script>` may fail a dependency-verification check in sandboxed shells — call the binary
directly (`./node_modules/.bin/tsx ...`, `./node_modules/.bin/vitest run`) if that happens.

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
- `scripts/bootstrap.ts` — the one-time devnet credential flow described in Tier 2 above: guest JWT →
  on-chain `subscribe` → token activation → writes `.env`.

## Testing

**Vitest**, **43 tests across 14 files**, all passing without a real Postgres connection — every test
wires a fake `Db` (`{ query: async () => ({ rows: [...] }) }`) instead. Two kinds of coverage:

- **Unit tests** on pure logic where a bug costs value: money rules (`markets.test.ts`), the
  settlement key mapping (`keys.test.ts`), the feed projector's event-diffing (`projector.test.ts`),
  the SSE record parser (`sse.test.ts`), and the TxLINE client's 401-renew/backoff/circuit-breaker
  behavior (`client.test.ts`, using an injected fake `fetch` and `wait` — no real network or timers).
- **Contract tests** hit every route in-process with `fastify.inject(...)` and assert the JSON
  response parses against the same Zod schema the frontend uses — this is what guarantees contract
  fidelity between backend and frontend without spinning up a browser or a real server.

```bash
./node_modules/.bin/vitest run          # run once — 43 passed (14 files)
./node_modules/.bin/vitest              # watch mode
```

## Deploy

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

## Networks

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

## Code standards

- **TypeScript strict** (`tsconfig.json`: `strict`, `noUnusedLocals`, `noUnusedParameters`,
  `noFallthroughCasesInSwitch`), ESM-only (`"type": "module"`, `verbatimModuleSyntax`).
- **No `as` casts, no `!` non-null assertions, no `any`** — narrow `unknown` with explicit type
  guards (see `src/txline/normalize.ts` for the pattern used throughout the feed layer).
- Comments only where they carry non-obvious *why* (a money rule, a TxLINE trap, a documented guess
  pending real data) — never comments that narrate what the code already says. Deliberate
  simplifications are marked `// ponytail: ...` with the upgrade condition named inline.
- Commits: English, short imperative, lowercase, no trailing period, no AI/tooling attribution.
