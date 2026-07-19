# Called It Backend — Milestone 2 (TxLINE Feed Integration) Plan

> Status: **built + reviewed** on 2026-07-18 (branch `feat/milestone-2-feed-integration`).
> This documents the milestone as delivered, for traceability. Design: `../specs/2026-07-18-backend-api-design.md` §9.

**Goal:** Turn `GET /api/feed/:matchId` into real, DB-backed projected data and record the live TxLINE
feed to `feed_events`, so the frontend feed stops being a stub.

## Global constraints
- Feed response parses against `matchSnapshotSchema` (frontend contract mirror).
- Clean-code: **no `as`/casts, no `!`, no `any`**; narrow `unknown` with type guards; explicit return types.
- Markets discovered from payload (trap #3); `seq >= 1` (trap #4); `ts`/`epochDay` from the feed, never `Date.now()`.
- Secrets (JWT/apiToken) never logged. ESM `.js` specifiers. Commits: English imperative lowercase, no LLM trace.

## Components (as built)

### Task A — projector + DB-backed feed
- `src/txline/types.ts` — `NormalizedScoreEvent`, `NormalizedOddsEvent` (internal normalized shapes).
- `src/txline/normalize.ts` — `normalizeScoreEvent`/`normalizeOddsEvent(raw: unknown) → … | null`; raw→normalized mapping isolated with `// verify against live sample` markers; rejects `seq < 1`; `toMillis` normalizes `ts` to milliseconds.
- `src/services/projector.ts` — pure `projectSnapshot(matchId, scoreEvents, oddsEvents, teams): MatchSnapshot`; diffs cumulative goals/yellow/red/corners between seq-ordered score events into `MatchEvent`s; pct/markets from the latest odds event; `gameState → period` lookup; output parses against `matchSnapshotSchema`.
- `src/services/feed.ts` — `getFeedSnapshot(db, matchId, teams)`: reads `feed_events`, normalizes, projects; empty → valid stub (never 404).
- `src/routes/feed.ts` — `GET /api/feed/:matchId` wired to `getFeedSnapshot`; feed route removed from `stubs.ts`.

### Task B — SSE ingester
- `src/txline/auth.ts` — `fetchGuestJwt(origin)` (POST `/auth/guest/start`).
- `src/txline/sse.ts` — pure `parseSseChunk` (CRLF-safe: normalizes `\r\n`/`\r` → `\n`, splits records, buffers partials).
- `src/txline/client.ts` — `streamEvents(...)` over native `fetch`; both auth headers; **capped exponential backoff**; **401-renew with a 5-consecutive-401 circuit breaker** (throws instead of tight-looping); injectable `fetchImpl`/`wait` for tests; respects `AbortSignal`.
- `src/ingester/recorder.ts` — `recordRawEvent(db, …)` idempotent `insert … on conflict (fixture_id, kind, seq) do nothing`.
- `src/ingester/index.ts` — `startIngester(db, config)`: shared JWT holder, both streams, normalize→record, `stop()`.
- `src/server.ts` — boot wiring: ingester starts only when `TXLINE_API_ORIGIN` + `TXLINE_API_TOKEN` present; app boots fine without them.

## Tests
Vitest: `parseSseChunk` (incl. CRLF), projector diffing + schema validity, feed service (fake db), recorder idempotency, **client 401-renew + backoff + cap** (injected fake `fetch`/`wait`, no network). **29 tests green**, `lint`/`type-check` clean.

## Review outcome
Whole-milestone review (`.superpowers/sdd/review-600bfd7..13ba700.diff`): fixed 1 Critical (401 tight-loop → backoff + cap + tests) and 4 Important (ts unit, `seq>=1`, CRLF, client tests). Deferred Minors marked with `ponytail:` (hardcoded `clockMin: 0`, VAR-reversal events).

## Known deferrals (need real data / later milestones)
- Field-name casing in `normalize.ts` and the `gameState → period` map are **documented guesses** (`// verify against live sample`) — confirm against a real TxLINE payload once credentials are in `.env`.
- `clockMin` is `0` (the documented feed shape carries no clock); `DEFAULT_TEAMS` placeholder until fixtures metadata lands.
