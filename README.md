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
