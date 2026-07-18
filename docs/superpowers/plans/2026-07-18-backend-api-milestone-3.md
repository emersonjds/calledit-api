# Called It Backend — Milestone 3 (Settlement) Plan

> Status: **planned** on 2026-07-18. Design: `../specs/2026-07-18-backend-api-design.md` §9.
> Reference: `../../../called-it/docs/txline-integration.md` §4 and `../../../called-it/docs/BACKEND.md` §2d.

**Goal:** Resolve provable predictions against the on-chain Merkle result — fetch the `stat-validation-v3`
proof for the market×period, verify the stat held, settle a points-based pot, and flip the prediction to
`won`/`lost` with a `settlement`. The prize feature is a **real CPI** into `txoracle` `validate_stat`.

## ⚠️ Blocking dependency
The real CPI **requires the network's `txoracle.json` IDL** (typed `Program<Txoracle>`) plus a funded
devnet service wallet and the program ID. Provide the IDL before Task 3–4. Until then, build the
proof-fetch + settlement predicate against the **documented `.view()` simulation fallback** (works, less
impressive) — the exact instruction name/args/accounts come from the IDL, not from docs.

## Global constraints
- Route **only `provable` markets** to settlement (goal/card/corner). `foul` stays points-only, never settles.
- `epochDay` derived from the proof `ts`, `seq` from the event — never `Date.now()` (trap #4).
- One network per credential set (trap #5). Settlement truth is on-chain — never trust the client.
- Clean-code: no `as`/casts/`!`/`any`; explicit types; ≤10s readability. Commits: English imperative, no LLM trace.

## Tasks

### Task 1 — provable key mapping (no chain, fully testable)
Port the 8-keys × periods mapping (`../../../called-it/src/entities/match/periods.ts` +
`prediction/markets.ts`): `settlementKey(period, baseKey) = prefix + baseKey` (e.g. 1st-half team-1 goal → `1001`).
`src/settlement/keys.ts` — `statKeysFor(market: Market, period): number[]`. Unit-test the mapping table.

### Task 2 — proof fetch
`src/settlement/proof.ts` — `fetchStatValidation(client, { fixtureId, seq, statKeys })` →
`GET /api/scores/stat-validation-v3?fixtureId=&seq=&statKeys=` (both auth headers; 1–5 keys). Narrow the
`ScoresStatValidationV3` response with type guards (no cast). Derive `epochDay` from `proof.ts`.

### Task 3 — settlement predicate (`.view()` fallback first, real CPI when IDL lands)
`src/settlement/validate.ts` — given the proof + the prediction's strategy (e.g. team-1 goals ≥ threshold),
evaluate whether the stat held. Phase 1: `program.methods.validateStat(...).view()` simulation returning the
boolean. Phase 2 (IDL required): the **real CPI** transaction that releases the pot on the boolean.

### Task 4 — pot + resolution
`src/settlement/settle.ts` — points-based escrow: on a resolved match event, for each `resolving` provable
prediction, fetch proof → evaluate → set `status = won|lost`, write `settlement { proofId, payoutSol,
calledSecondsBefore, resolvedEvent }`, credit points on win. Wire `GET /api/predictions/:id` to return the
`settlement` once resolved (already polled by the frontend). Real-money escrow stays **out of scope**
(licensing) — points/free-to-play only.

## Tests
Vitest: key mapping table; proof-response guard (valid/invalid shapes); predicate over a fixture proof
(mocked); settlement flips status + writes `settlement` (fake db). On-chain calls mocked at the boundary —
no devnet in unit tests. A real devnet CPI smoke test happens once the IDL + wallet are wired.

## Out of scope (hackathon)
Real-money escrow/payout (needs licensing), multi-match orchestration, KYC.
