# Real end-to-end bet flow on devnet — design

**Date:** 2026-07-19
**Owner:** Emerson
**Goal:** Prove the tool works end to end with real devnet value: a user stakes real
devnet SOL (Phantom-signed transfer), the backend verifies that transfer on-chain and
escrows it, settles the prediction from the recorded TxLINE feed (with the on-chain
`validate_stat` boolean stamped alongside), and pays the winner a real devnet SOL transfer.
Money actually moves; every leg is a real transaction visible on the Solana explorer.

**Approach chosen:** A — plain SOL transfers, no custom Rust program, no deploy. The service
wallet (`2t5SHE9udJWswb5GqKMzvRhE836uyzkdkQJGf1sHhi8p`, ~6 devnet SOL) is the escrow: stakes
go **to** it, payouts come **from** it.

## Repos

- **Frontend** `/Users/emerson/Documents/workspace/hackathons/called-it` (Vite + React, devnet). Branch: cut a feature branch from `master`.
- **Backend** `/Users/emerson/Documents/workspace/hackathons/calledit-api` (Fastify + Postgres + Solana). Branch: continue on `feat/onchain-validate-stat` (the `validate_stat` de-risk is a dependency of this flow's settlement stamp).

## Global constraints

- Network = **devnet** everywhere (frontend `VITE_SOLANA_RPC_URL`, backend `SOLANA_RPC_URL`), one network or it fails.
- Treasury/escrow pubkey = the service wallet's public key. Frontend `VITE_TREASURY_ADDRESS` MUST equal the backend service keypair's pubkey (`2t5SHE9udJWswb5GqKMzvRhE836uyzkdkQJGf1sHhi8p`). Backend derives it from the keypair so they can't drift.
- `SERVICE_WALLET_SECRET` is a **path** to a Solana CLI JSON keyfile (`.devnet/service-keypair.json`, gitignored) — the loader reads the file → `Uint8Array` → `Keypair.fromSecretKey`. Never log, never commit the secret or the keyfile.
- Money math: `lamports = Math.round(sol * LAMPORTS_PER_SOL)`. Stakes kept small for the demo (service wallet must cover payouts + fees).
- `epochDay`/`stampedAt` derive from the real on-chain tx `blockTime` when available, never `Date.now()` for the stamp.
- Idempotency: a prediction must never pay out twice. Settlement claims the row atomically (`status='resolving'` → `'settling'`) before sending SOL, then finalizes to `won`/`lost` with the payout signature.
- Payout DECISION is the off-chain predicate (`resolvePrediction` over recorded `feed_events`); the on-chain `validate_stat` boolean is recorded as `verifiedOnChain` (a real on-chain confirmation stamp), not a gate — keeps the demo robust if devnet root data is momentarily unavailable.
- No LLM trace in commits (project rule); micro conventional-commits, lowercase, Portuguese, no trailing period.

## Flow (happy path)

```
[FE] user picks market + stake, clicks CALL IT
[FE] build SystemProgram.transfer(user → treasury, stakeSol) → Phantom signAndSendTransaction → real sig
[FE] wait for confirmation → POST /api/predictions { matchId, market, stakeSol, address, stakeTxSig }
[BE] verify sig on-chain: confirmed, transfer, from=address, to=treasury, lamports≈stakeSol → else 400
[BE] store real sig as tx_hash, stamp from blockTime, status='resolving'
[BE] settlement worker: match resolves from feed_events → resolvePrediction → won/lost
[BE]   on won: claim row (resolving→settling), transfer(treasury → user, payoutSol), record payoutTxHash
[BE]   stamp verifiedOnChain from validate_stat .view() (best-effort)
[FE] GET /api/predictions/:id shows real stakeTx + settlement.payoutTxHash + verifiedOnChain
```

## Backend components

- **`src/onchain/serviceWallet.ts`** (new): `loadServiceKeypair(): Keypair` (reads the keyfile path from `SERVICE_WALLET_SECRET`, supports a JSON array or base58 fallback); `treasuryPubkey(): PublicKey` (the keypair's public key). Reuses `getConnection()`.
- **`src/onchain/stake.ts`** (new):
  - `verifyStakeTransfer(sig: string, from: string, lamports: number): Promise<{ ok: boolean; blockTime: number | null; reason?: string }>` — `getParsedTransaction(sig, { maxSupportedTransactionVersion: 0 })`; assert success (no `meta.err`), a `system` `transfer` instruction with `info.source === from`, `info.destination === treasury`, `info.lamports >= lamports` (allow ≥ to tolerate rounding). Returns reason on mismatch.
  - `sendPayout(to: string, lamports: number): Promise<string>` — build `SystemProgram.transfer(treasury → to)`, `sendAndConfirmTransaction(connection, tx, [serviceKeypair])`, return signature.
- **`src/schemas/index.ts`** (modify): `commitPredictionSchema += stakeTxSig: z.string().min(1)`; `settlementSchema += payoutTxHash: z.string().optional()`.
- **`src/services/predictions.ts`** (modify): before insert, `verifyStakeTransfer(input.stakeTxSig, input.address, stakeLamports)`; on failure throw a 400-mapped error. Store `input.stakeTxSig` in `tx_hash`; derive `stampedAt` from `blockTime*1000` (fallback current behavior only if blockTime null), `epochDay` from that.
- **`src/settlement/worker.ts`** (modify): widen the resolving SELECT + `ResolvingRow` to include `address`. In `settleOne`, on `outcome.status==='won'`: atomically claim (`update predictions set status='settling' where id=$1 and status='resolving'`; if 0 rows, skip — already claimed), then `sendPayout(address, payoutLamports)`, set `outcome.settlement.payoutTxHash`, finalize with the existing update to `status='won'`. On `lost`, finalize directly. Keep the on-chain `verifyStat` stamp (already present) in its try/catch.
- **`src/routes/predictions.ts`** (modify): map the stake-verification error to HTTP 400 with a clear message.

## Frontend components (`called-it`)

- **dependency**: add `@solana/web3.js`.
- **`src/shared/config.ts`** (modify) + env: `TREASURY_ADDRESS` from `VITE_TREASURY_ADDRESS` (= service wallet pubkey).
- **`src/entities/wallet/adapters.ts`** (modify): extend `SolanaProvider` with `signAndSendTransaction(tx): Promise<{ signature: string }>` and `publicKey` (Phantom's native API).
- **`src/shared/lib/solana-transfer.ts`** (new): `signStakeTransfer(from: string, lamports: number): Promise<string>` — `new Connection(SOLANA_RPC_URL)`, `getLatestBlockhash`, build `Transaction().add(SystemProgram.transfer({ fromPubkey, toPubkey: TREASURY, lamports }))`, `provider.signAndSendTransaction(tx)`, `confirmTransaction`, return signature.
- **`src/shared/api/client.ts`** (modify): `CommitPredictionInput += stakeTxSig: string`; include it in the POST body.
- **`src/features/prediction.ts`** (modify): in `useMakePrediction.mutationFn`, before `api.commitPrediction`, call `signStakeTransfer(address, stakeLamports)` to get the real signature, then commit with `stakeTxSig`. Surface a clear error if the user rejects the Phantom prompt.
- **do-nothing**: `useOnchainBalance`/`solana-rpc.ts` (already real reads), `StakeSelector`, `live-match.tsx`, `prediction-overlay.tsx` (already render `stamp.txHash`).

## Error handling

- Phantom rejects / no Phantom → surface a user-visible error, no commit.
- Stake tx not found / not confirmed yet → backend 400 "stake transfer not confirmed"; frontend waits for confirmation before POST to avoid this.
- Stake mismatch (wrong dest/amount/sender) → backend 400, prediction not created.
- Payout send failure → prediction stays `settling`; a later tick retries (claim guard prevents double-send only after success; a failed send leaves it claimable — log loudly, do not silently drop). Ceiling noted below.
- Service wallet out of SOL → payout fails, logged; demo precondition is a funded wallet.

## Open risks

1. **Idempotency ceiling**: a crash between `sendPayout` success and the finalize `update` could re-pay on the next tick (row still `settling`). Mitigation for the hackathon: finalize immediately after send; the window is milliseconds. A durable fix (record the payout sig before send, or check recent treasury→address txs before resending) is post-hackathon. `ponytail:` comment marks it.
2. **Phantom `signAndSendTransaction` shape** varies by version; verify against the injected provider at runtime.
3. **validate_stat live proof** (separate in-flight task) — its success is NOT required for payout; if unavailable, `verifiedOnChain` stays unset and the flow still completes.

## Success criteria

On the live devnet match: clicking CALL IT opens Phantom, signs a real transfer (visible on
explorer), the prediction records the real stake signature; when the market resolves the
winner receives a real devnet SOL payout (second explorer-visible tx) and the prediction
shows `payoutTxHash` + `verifiedOnChain`. The service wallet balance moves accordingly.
