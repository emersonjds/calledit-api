<div align="center">

# CALLED ⚡T

### World Cup 2026 Prediction Backend

**Live, on-chain-verified predictions on Solana.**
Call the next **goal**, **corner** or **card** in a match already in play — your call is stamped on-chain with a real stake, and settlement is provable. No house. You call it, the chain proves it.

<br/>

[![Solana](https://img.shields.io/badge/Solana-devnet-B6FF3C?labelColor=0B0F14)](https://explorer.solana.com/?cluster=devnet)
[![Fastify](https://img.shields.io/badge/Fastify-5-FF7A18?labelColor=0B0F14)](https://fastify.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-B6FF3C?labelColor=0B0F14)](https://www.typescriptlang.org)
[![Postgres](https://img.shields.io/badge/Postgres-16-FF7A18?labelColor=0B0F14)](https://www.postgresql.org)
[![Docker](https://img.shields.io/badge/Docker-compose-B6FF3C?labelColor=0B0F14)](https://www.docker.com)
[![Railway](https://img.shields.io/badge/Railway-deployed-FF7A18?labelColor=0B0F14)](https://calledit-api-production.up.railway.app/swagger)

**[Live API](https://calledit-api-production.up.railway.app)** · **[Swagger](https://calledit-api-production.up.railway.app/swagger)** · **[Frontend](https://called-it.netlify.app)**

</div>

---

## 🐳 Run with Docker (one command)

The whole stack — API **and** Postgres — comes up together:

```bash
git clone https://github.com/emersonjds/calledit-api.git
cd calledit-api
docker compose up --build
```

→ **API at http://localhost:3000** · Swagger at **/swagger** · health at **/health**.

The API boots and predictions persist right away. The **live TxLINE feed + on-chain settlement are optional** — to enable them, drop the credentials into a `.env` and uncomment the `env_file:` line in `docker-compose.yml`.

## 🧑‍💻 Run locally (without Docker)

**Prerequisites:** Node 22+, `pnpm`, Docker (for Postgres).

```bash
pnpm install
docker compose up -d postgres                 # just the database
DATABASE_URL=postgres://calledit:calledit@localhost:5432/calledit pnpm migrate
pnpm dev                                       # hot-reload dev server
```

## 🏗️ Architecture

```mermaid
flowchart LR
  FE["Frontend<br/>(Phantom wallet)"]
  API["calledit-api<br/>(Fastify + Postgres)"]
  FEED["TxLINE<br/>(TxODDS live SSE)"]
  SOL["Solana<br/>(TxOracle · settle · payout)"]

  FE -->|1 · signs a real<br/>devnet stake| SOL
  FE -->|2 · POST /api/predictions<br/>+ stakeTxSig| API
  API -->|3 · verifies the tx<br/>on-chain, stamps it| SOL
  FEED -->|4 · live feed<br/>ingested| API
  API -->|5 · settle + pay<br/>the winner| SOL
```

## ⚡ Prediction flow

1. **Stake** — the wallet signs a real devnet SOL transfer to the treasury.
2. **Commit** — `POST /api/predictions` with the `stakeTxSig`; the backend verifies the transfer on-chain and stamps the call (`status: resolving`).
3. **Ingest** — live TxLINE events (goals, cards, corners) stream into `feed_events`.
4. **Settle** — a worker resolves provable markets within a per-market window (**goal 2 min · corner/card 1 min**), validates the stat on-chain (`validate_stat`), and pays winners with a real transfer. `foul` is for-fun and always resolves — it never hangs.

## 🔌 API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Liveness probe |
| `GET` | `/swagger` | Interactive API docs (OpenAPI) |
| `POST` | `/api/predictions` | Create a prediction (verifies the on-chain stake) |
| `GET` | `/api/predictions/:id` | Fetch one prediction |
| `GET` | `/api/predictions?address=` | List a wallet's predictions |
| `GET` | `/api/feed/:matchId` | Live match snapshot (score · odds · markets) |
| `GET` | `/api/fixtures/upcoming` | Live fixtures |

> `wallet` · `me` · `leaderboard` return valid-shaped stub data (later milestones).

## ⚙️ Environment

| Variable | Required | Notes |
|----------|:---:|-------|
| `DATABASE_URL` | ✅ | Postgres connection string |
| `PORT` | | Default `3000` |
| `CORS_ORIGINS` | | Comma-separated allow-list (localhost always allowed) |
| `NETWORK` · `SOLANA_RPC_URL` | | Solana cluster + RPC (devnet) |
| `TXORACLE_PROGRAM_ID` · `TXL_TOKEN_MINT` | | On-chain program + mint |
| `TXLINE_API_ORIGIN` · `TXLINE_API_TOKEN` · `TXLINE_JWT` | | Live feed credentials (guest JWT auto-renews) |
| `SERVICE_WALLET_SECRET` | | Solana keypair (path or inline JSON) — **never committed** |

Secrets live only in `.env` (gitignored) or the deploy environment.

## 🚀 Deploy

Deployed on **Railway** — a push to `master` auto-deploys. Live API: **https://calledit-api-production.up.railway.app** (Swagger at `/swagger`).

## 📌 Details

- **Provable markets:** `goal`, `card`, `corner` — backed by TxLINE Merkle-provable stat keys. `foul` is for-fun.
- **Timestamps:** UTC ISO 8601; stake/payout amounts in integer base units (lamports).
