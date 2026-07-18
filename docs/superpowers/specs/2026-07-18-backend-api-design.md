# Called It — Backend API Design

> Date: 2026-07-18 · Status: approved · Owner: Emerson
> Companion refs: the frontend repo's `docs/BACKEND.md`, `docs/txline-integration.md`, `docs/SPEC.md`.
> This spec drives the implementation plan (`writing-plans` next).

## 1. Purpose

`calledit-api` is the backend that replaces MSW at the network boundary of the **Called It** PWA and
delivers the prize feature: a **real CPI settlement** into the on-chain `txoracle` program. It serves
the six REST seams the frontend already assumes, ingests the TxODDS **TxLINE** feed, and settles
provable predictions against the on-chain Merkle result.

It is a **single Node service** (TypeScript, ESM, Fastify) that serves the API and — from milestone 2
on — runs the always-on SSE ingester in the same process. Postgres is the store.

## 2. Constraints (non-negotiable)

- **Contract fidelity:** every response must match the Zod shapes the frontend validates
  (`src/shared/api/schemas.ts`). The backend mirrors those schemas as its own source of truth.
- **TxLINE traps:** SL 12 (not SL 1); record the feed early (system of record on disk/DB); no hardcoded
  market catalog (discover from payload); `seq >= 1` and `epochDay` derived from the proof `ts` — never
  `Date.now()`; one network per credential set (no devnet/mainnet mixing).
- **Provability:** only goals/cards/corners settle on-chain (8 TxLINE keys, per team/period).
  `foul` is points-only (`provable: false`) and must never be routed to settlement.
- **Security:** wallet keys never leave the wallet; the service wallet secret and TxLINE JWT/apiToken
  never get logged or committed; settlement truth is on-chain, never trusted from the client.

## 3. Infrastructure

- **Compute + DB: Render** (single vendor, per decision 2026-07-18). One Render **web service** runs
  Fastify (serves API + SSE loop); **Render Postgres** via `DATABASE_URL`.
- Caveat accepted: Render free Postgres expires in ~90 days — fine for the hackathon window.
- The Render web service must **not sleep** (SSE ingester is continuous) → Starter instance.

## 4. Stack

Node 20+ · TypeScript (ESM) · **Fastify** · `@fastify/swagger` + `@fastify/swagger-ui` ·
`fastify-type-provider-zod` · **Zod** · `pg` (node-postgres) · `tsx` (dev) · **Vitest** (tests).
On-chain/feed libs enter in later milestones: `@coral-xyz/anchor`, `@solana/web3.js`,
`@solana/spl-token` (Token-2022), `tweetnacl`, an SSE client.

## 5. Project structure

```
calledit-api/
├── src/
│   ├── app.ts              # fastify instance: swagger, cors, zod type-provider, error handler
│   ├── server.ts           # listen; later: start ingester on boot
│   ├── config/env.ts       # Zod-validated env — fail fast if missing
│   ├── db/
│   │   ├── pool.ts         # pg Pool from DATABASE_URL
│   │   ├── schema.sql      # feed_events, predictions
│   │   └── migrate.ts      # apply schema.sql
│   ├── schemas/            # Zod DTOs mirroring the frontend contracts
│   ├── routes/             # wallet, feed, predictions, profile, leaderboard, health
│   ├── services/           # business logic (stubbed in milestone 1)
│   └── ingester/           # SSE loop skeleton (built in milestone 2)
├── .claude/agents/         # arq, back, bug, qa, redteam, scribe (backend-adapted)
├── .mcp.json               # serena, context-mode, context7
├── docs/superpowers/specs/ # this spec + implementation plan
├── .env.example · package.json · tsconfig.json · README.md
```

## 6. Data model (Postgres)

Two tables; profile and leaderboard are **derived queries**, not tables.

```sql
create table feed_events (
  id          bigserial primary key,
  fixture_id  text not null,
  seq         int  not null,          -- >= 1 (trap #4)
  kind        text not null,          -- 'score' | 'odds'
  ts          timestamptz not null,   -- from the proof, never Date.now()
  payload     jsonb not null,
  unique (fixture_id, kind, seq)      -- idempotent on SSE reconnect
);
create index on feed_events (fixture_id, seq);

create table predictions (
  id            uuid primary key,
  address       text not null,
  match_id      text not null,
  market        text not null,
  provable      boolean not null,     -- gates settlement
  stake_sol     numeric not null,
  multiplier    numeric not null,
  status        text not null default 'resolving',  -- resolving | won | lost
  tx_hash       text,                 -- on-chain stamp
  seq           int, epoch_day int,   -- from proof/event, not local clock
  settlement    jsonb,
  created_at    timestamptz not null default now()
);
create index on predictions (address);
create index on predictions (match_id);
```

## 7. API contract (the six seams)

All request/response bodies validated by Zod; OpenAPI generated from the same schemas.

| Method + path                   | Returns (Zod shape)                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| `POST /api/wallet/connect`      | `WalletAccount { address, balanceSol, chain, provider }`                            |
| `GET /api/feed/:matchId`        | `MatchSnapshot { matchId, clockMin, period, home, away, score, pct, events, markets, live }` |
| `POST /api/predictions`         | `Prediction { id, matchId, market, provable, stakeSol, multiplier, potentialSol, atClockMin, windowMin, status, stamp, settlement? }` |
| `GET /api/predictions/:id`      | same `Prediction` (poll until `won`/`lost` with `settlement`)                       |
| `GET /api/me?address=`          | `ProfileDto { address, handle, accuracy, totalCalls, wonCalls, bestStreak, currentStreak, rank, balanceSol }` |
| `GET /api/leaderboard?address=` | `LeaderboardDto { entries[] }`                                                      |

Hard schema rules honored: `stamp.seq >= 1` (int), `epochDay` int, `provable` gates settlement.
Plus `GET /health` (liveness) and `GET /docs` (Swagger UI, Fastify logo removed via injected CSS).

## 8. Error handling & validation

- Zod validation at every boundary; a Zod failure → `400` with a structured `{ error, details }`.
- Central Fastify error handler maps thrown domain errors to status codes; never leaks stack/secrets.
- Env validated at boot (`config/env.ts`) — the process refuses to start with missing/invalid config.

## 9. Milestones

**Milestone 1 — API skeleton (this build):** Fastify app + clean Swagger + CORS + Zod type-provider +
error handler + env + Postgres pool + schema/migrate + the six endpoints returning valid shapes
(predictions persisted to/read from DB; wallet/feed/profile/leaderboard served as valid-shaped stubs) +
`/health` + deploy-ready on Render. Runs locally and deploys. In this milestone the prediction `stamp`
(`txHash`, `seq`, `epochDay`) is a valid-shaped **stub** — no chain yet — replaced by the real on-chain
stamp in milestone 3; `status` starts `resolving`.

**Milestone 2 — real feed:** SSE ingester (`/scores/stream` + `/odds/stream`, auth, auto-reconnect,
401-renew) persisting raw events to `feed_events`; match-state projector folding events into
`MatchSnapshot` (markets discovered from payload). `GET /api/feed/:matchId` serves real data.

**Milestone 3 — settlement:** fetch `stat-validation-v3` proof for the market×period via
`periodKey(period, baseKey)`; **real CPI** into `txoracle` `validate_stat`; points-based escrow pays out
on the boolean. Only `provable` markets routed here.

**Milestone 4 — swap:** replace each stub with the real service; frontend drops MSW behind the seams.

## 10. Testing

- **Vitest** unit tests on money/settlement logic (payout, multiplier, provability gating) — the parts
  where a bug costs value.
- **Contract tests:** hit each route in-process (`fastify.inject`) and assert the response parses against
  the frontend Zod schema — guarantees contract fidelity.
- No secrets in tests; external calls (RPC, TxLINE) mocked at the boundary.

## 11. Agents migration

Move the backend set into `.claude/agents/`: `arq`, `back`, `bug`, `qa`, `redteam`, `scribe`. Adapt each
away from frontend framing (React/PWA/Playwright) toward Fastify/Postgres/Solana/feed:
`back` and `arq` change little; `qa` becomes integration/contract testing; `redteam` focuses on API,
key handling, and feed manipulation; `scribe` documents the API. `.mcp.json` (serena, context-mode,
context7) copied over.

## 12. Env / secrets

```
NODE_ENV · PORT · DATABASE_URL
NETWORK=mainnet|devnet · SOLANA_RPC_URL · TXORACLE_PROGRAM_ID · TXL_TOKEN_MINT
TXLINE_API_ORIGIN · TXLINE_JWT · TXLINE_API_TOKEN
SERVICE_WALLET_SECRET   # never committed; .env is gitignored
```

## 13. Out of scope (hackathon)

Real-money escrow (needs licensing — ship points/free-to-play), KYC, multi-match orchestration,
horizontal scaling. Post-hackathon concerns.
