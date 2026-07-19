# Called It — World Cup 2026 Prediction Backend

**Live, on-chain-verified FIFA World Cup 2026 predictions on Solana.** Users commit predictions before events, stake real devnet SOL, and settlement is determined by provable stats from the TxLINE feed.

[![Solana devnet](https://img.shields.io/badge/Solana-devnet-14F195?style=flat-square&logo=solana)](https://solscan.io/?cluster=devnet)
[![Fastify 5](https://img.shields.io/badge/Fastify-5-000000?style=flat-square&logo=fastify)](https://fastify.io)
[![Railway](https://img.shields.io/badge/Deployed-Railway-0B0D0E?style=flat-square&logo=railway)](https://railway.app)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org)

## Quick Start

**Prerequisites:** Node 22+, Docker, `pnpm`.

```bash
git clone https://github.com/emersonjds/calledit-api.git
cd calledit-api
pnpm install

# Start local Postgres
docker compose up -d

# Apply schema
DATABASE_URL=postgres://calledit:calledit@localhost:5432/calledit \
  pnpm migrate

# Run the API
pnpm dev
```

→ API at **http://localhost:3000** · Swagger UI at **http://localhost:3000/swagger** · Health check at `/health`.

**Without TxLINE credentials**, the API still boots and predictions persist to Postgres, but `/api/fixtures/upcoming` and `/api/feed/:matchId` need the live TxLINE feed (the ingester stays disabled). The `wallet` / `me` / `leaderboard` routes always return valid-shaped stub data.

Example request (the wallet must have already sent the devnet stake transfer; pass its signature as `stakeTxSig`):
```bash
curl -X POST http://localhost:3000/api/predictions \
  -H 'content-type: application/json' \
  -d '{
    "matchId": "18257739",
    "market": "goal",
    "stakeSol": 0.01,
    "address": "<your devnet pubkey>",
    "stakeTxSig": "<confirmed devnet transfer signature>"
  }'
```

## Architecture

```mermaid
flowchart LR
  FE["Frontend<br/>(Phantom wallet)"]
  API["calledit-api<br/>(Fastify)"]
  DB["Postgres<br/>(predictions, feed_events)"]
  FEED["TxLINE<br/>(TxODDS SSE)"]
  SOL["Solana<br/>(txoracle, settle)"]

  FE -->|sign devnet<br/>stake tx| SOL
  FE -->|POST /api/predictions<br/>+ stakeTxSig| API
  API -->|verify tx<br/>stamp call| SOL
  API -->|read/write| DB
  FEED -->|SSE stream| API
  API -->|CPI validate_stat<br/>+ payout| SOL
```

## E2E Prediction Flow

1. **Commit**: Wallet signs a real devnet SOL transfer to the service wallet; sends `POST /api/predictions` with stake amount and `stakeTxSig`.
2. **Stamp**: Backend verifies the on-chain transfer (`getParsedTransaction`), records prediction with `status=resolving`, returns `stamp` (txHash, blockTime, seq, epochDay).
3. **Ingest**: Live TxLINE feed events (goals, cards, corners) stream via SSE into `feed_events` table.
4. **Settle** (every 10s): Settlement worker reads feed events and predictions. For provable markets (goal/card/corner) it resolves off-chain — the market's stat rising inside the 5-minute window is the source of truth — and additionally validates the stat on-chain via the txoracle program's `validate_stat` (Merkle proof), stored as an advisory `verifiedOnChain` flag. `foul` never settles.
5. **Resolve & pay**: on a win the backend pays the winner with a real service-wallet transfer (`payoutTxHash`) and flips status to `won`/`lost`; the frontend polls `GET /api/predictions/:id` until status changes.

## API Endpoints

| Method | Path | Purpose | Backing |
|--------|------|---------|---------|
| GET | `/health` | Liveness probe | — |
| GET | `/swagger`, `/swagger/json` | Swagger UI / OpenAPI | — |
| POST | `/api/predictions` | Create a prediction (verifies the on-chain stake) | Postgres + Solana |
| GET | `/api/predictions/:id` | Fetch one prediction | Postgres |
| GET | `/api/predictions?address=` | List predictions by wallet | Postgres |
| GET | `/api/feed/:matchId` | Live match snapshot (score, odds, markets) | Postgres (TxLINE-backed) |
| GET | `/api/fixtures/upcoming` | Live fixtures | TxLINE |
| POST | `/api/wallet/connect` | Connect a wallet | stub |
| GET, POST, DELETE | `/api/wallet/*` | Wallet balance, deposits, withdrawals | stub |
| GET | `/api/me?address=` | Caller profile (accuracy, rank) | stub |
| GET | `/api/leaderboard` | Global leaderboard | stub |

**Stub routes** return valid-shaped data but are not yet backed by real services — planned for later milestones.

## Environment Variables

| Variable | Required | Notes |
|----------|----------|-------|
| `NODE_ENV` | no | `development` or `production` |
| `PORT` | no | Default: `3000` |
| `DATABASE_URL` | **yes** | Postgres connection string |
| `NETWORK` | no | `devnet` or `mainnet` (dev uses devnet) |
| `SOLANA_RPC_URL` | no | RPC endpoint for the selected network |
| `TXORACLE_PROGRAM_ID` | no | On-chain txoracle program address |
| `TXL_TOKEN_MINT` | no | TxL token mint for the selected network |
| `TXLINE_API_ORIGIN` | no | TxLINE API host (e.g., `https://txline-dev.txodds.com`) |
| `TXLINE_API_TOKEN` | no | Static API token (obtained via bootstrap flow) |
| `TXLINE_JWT` | no | Seed JWT; auto-renewed on expiry |
| `CORS_ORIGINS` | no | Comma-separated allow-list (no trailing slash) |
| `SERVICE_WALLET_SECRET` | no | Path to Solana keypair JSON file, or inline JSON array — **never committed** |

All secrets live only in `.env` (gitignored) or deployment environment — never in code or git history.

## Local Development

```bash
# Watch and hot-reload
pnpm dev

# Type-check
pnpm type-check

# Lint / format
pnpm lint:fix
pnpm format

# Build for production
pnpm build

# Start compiled build
pnpm start

# Apply or reset migrations
pnpm migrate
```

## Deploy to Railway

Deployed on **Railway** — a push to `master` auto-deploys. Live API: **https://calledit-api-production.up.railway.app** (Swagger at `/swagger`).

## Key Details

**Solana networks:** devnet (free test SOL, prove the on-chain path) and mainnet (real World Cup 2026 feed, live service level 12). Never mix credentials across networks — TxLINE API returns 403 otherwise.

**Provable markets:** `goal`, `card`, and `corner` — each backed by TxLINE Merkle-provable stat keys. `foul` is stub-only.

**Timestamps:** All times are UTC ISO 8601. Stake/payout amounts are integer base units (lamports/USDC decimals) unless explicitly noted.
