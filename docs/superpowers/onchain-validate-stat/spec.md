# On-chain `validate_stat` de-risk — design

**Date:** 2026-07-19
**Owner:** Emerson
**Goal:** Prove the on-chain path is functional — fetch a real TxLINE Merkle proof, call
`txoracle.validate_stat` against the live program, and read the boolean it returns. Then wire that
boolean into the settlement service. This closes the "prize" gap flagged in the Backend Report:
today settlement is an off-chain time-window predicate with no on-chain verification.

## Scope

**In:** a real `validate_stat` call via Anchor `.view()` (simulation) against the network in `.env`,
using a real proof for a fixture/seq; a runnable de-risk script that prints the boolean; wiring the
boolean into `settlement`.

**Test target: devnet.** The de-risk runs against **devnet** (`api.devnet.solana.com`, program
`6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`) — the report's "cheap proving" path (airdroppable
SOL, `request_devnet_faucet`). The code stays env-driven; for the test run the `.env` points **all of
one network** at devnet: `NETWORK=devnet`, devnet `SOLANA_RPC_URL`, devnet `TXORACLE_PROGRAM_ID`,
devnet `TXLINE_API_ORIGIN`, and a devnet JWT/API token. Caveat: devnet must have a fixture whose
batch root is published on the devnet program — real-time World Cup data lives on mainnet SL 12, so
the devnet proof will be a **devnet test fixture**, not a live match. If devnet exposes no
proof-backed fixture, the fallback is to run the same env-driven path against mainnet (read-only
`.view()` needs no funds). The de-risk script surfaces which case we're in immediately.

**Out (later milestones):** our own Anchor/Rust program performing a true CPI that releases a pot on
the boolean (Days 2–3 in the report); real-money escrow. `.view()` is the report's accepted path and
is what official examples use — no public example does the CPI, so `.view()` is the correct de-risk.

## Non-negotiables (from the report / integration doc)

- `seq` ≥ 1 (seq=0 rejected on-chain), taken from the feed/proof — never `Date.now()`.
- `epochDay` derives from the proof `ts`, never the clock.
- Proof and on-chain batch root must be on the **same network** as `TXORACLE_PROGRAM_ID`, or 403.
- The exact instruction args/accounts come from `idl/txoracle.json` — the IDL is the authority.

## Architecture

```
feed_events (fixtureId, seq)               already recorded — our system of record
   → GET /api/scores/stat-validation-v3    real TxLINE call, both auth headers
        returns ScoresStatValidationV3 { ts, summary, statsToProve[], multiproof,
                                          subTreeProof, mainTreeProof }
   → map to validate_stat args             IDL is authority; ProofNode = { hash: Buffer, isRightSibling: bool }
   → Program<Txoracle>.methods.validateStat(...).view()   → boolean (on-chain re-hash to batch root)
   → settlement records { proofId, verifiedOnChain, epochDay }
```

## Components (isolated, pure TS — no Rust, no deploy)

### `src/onchain/anchor.ts`
Builds a read-only `Program` from `idl/txoracle.json` at `env.TXORACLE_PROGRAM_ID` over a
`Connection(env.SOLANA_RPC_URL)`. No wallet needed for `.view()` — use a dummy/read-only provider.
Exposes a single lazily-constructed `getTxoracle()`.

- **Depends on:** `@coral-xyz/anchor`, `@solana/web3.js`, `env`.
- **Interface:** `getTxoracle(): Program<Txoracle>`.

### `src/onchain/verifier.ts`
Maps a `ScoresStatValidationV3` proof + a predicate to `validate_stat` args and calls the program.

- **Interface:** `verifyStat(proof, predicate): Promise<{ ok: boolean; proofId: string; epochDay: number }>`
- Maps: `ts` → i64; `summary` → `ScoresBatchSummary`; `subTreeProof`/`mainTreeProof` →
  `fixture_proof`/`main_tree_proof` (`ProofNode[]`); `statsToProve` → `stat_a` (+ optional `stat_b`);
  `predicate` → `TraderPredicate`; `op` → optional `BinaryExpression`. Field byte shapes read from IDL.
- `epochDay = floor(proof.ts / 86_400_000)` (from the proof `ts`, not the clock).
- **Read method:** `.view()` if the IDL exposes a return type; otherwise `.simulate()` and decode the
  `Program return:` data (bool). Decision made at implementation once the IDL return is confirmed.
- **Depends on:** `anchor.ts`, IDL types.

### `src/txline/api.ts` — add `fetchStatProof`
`fetchStatProof(fixtureId: number, seq: number, statKeys: string): Promise<ScoresStatValidationV3>`
— `GET /api/scores/stat-validation-v3?fixtureId=&seq=&statKeys=` with both auth headers, via the
existing `txlineGet` plumbing (JWT renew on 401 already handled there).

### `scripts/prove-onchain.ts` — the de-risk artifact
CLI: `pnpm tsx scripts/prove-onchain.ts <fixtureId> <seq> <statKeys> [predicate]`. Defaults to the
most recent recorded `(fixtureId, seq)` from `feed_events` if args omitted. Fetches the proof, calls
`verifyStat`, prints `✓ on-chain validate_stat = true|false` (or a clear failure). This is the
runnable proof that the tool works.

### Settlement wiring — `src/settlement/settle.ts` / `worker.ts`
When a provable market resolves, in addition to the off-chain predicate, call `verifyStat` for that
fixture/seq and record `verifiedOnChain: boolean` + the real `proofId` on the `settlement`. The
off-chain predicate stays as the fallback path (report treats `.view()` + off-chain as valid).
Schema change: extend `settlementSchema` with `verifiedOnChain?: boolean`.

## Data flow / error handling

- **401** from the proof endpoint → renew JWT on the same host (existing `txline/client` behavior),
  retry with the same API token.
- **403** → assert one network across RPC / program ID / JWT host (trap #5); surface a clear message.
- **Root account not found / wrong network** → explicit error naming the network + program ID.
- Never log or persist `TXLINE_JWT` / `TXLINE_API_TOKEN` / `SERVICE_WALLET_SECRET`.

## Open risk to resolve during implementation

1. **`daily_scores_merkle_roots` address** — the only account on `validate_stat`; not a PDA in the
   IDL and not in `accounts[]`. Resolve via: (a) PDA seed derivation if the program uses one,
   (b) `getProgramAccounts` filtered by discriminator, or (c) the quickstart's known address. This is
   the primary investigative risk; the de-risk script surfaces it immediately.
2. **`.view()` vs `.simulate()`** — IDL `returns` for `validate_stat` is absent; confirm how the
   boolean comes back and decode accordingly.

## Testing

- **Unit self-check:** arg-mapping produces correct byte shapes — `ProofNode` encodes as
  `{ hash: Buffer, isRightSibling: bool }`, `ts` as i64, stat keys as `prefix + baseKey`. One
  `assert`-based check, no framework beyond the existing `vitest`.
- **Live de-risk:** `scripts/prove-onchain.ts` against the real network prints the boolean. This is
  the acceptance signal — the whole task exists to make this print `✓`.

## Success criteria

`pnpm tsx scripts/prove-onchain.ts` fetches a real proof and prints a real on-chain boolean from
`validate_stat`, and a resolved provable prediction carries `verifiedOnChain` in its settlement.
