# Real end-to-end bet flow — Implementation Plan

> **For agentic workers:** implement task-by-task, TDD where noted, micro-commits (Portuguese, lowercase, no trailing period, NO LLM trace).

**Goal:** Real devnet SOL stake (Phantom-signed) → backend verifies + escrows → settles from feed → real SOL payout to winner. Every leg a real on-chain tx.

**Architecture:** Approach A — plain `SystemProgram.transfer`, service wallet as escrow, no custom program. Frontend `called-it` (Vite+React), backend `calledit-api` (Fastify+pg+web3.js).

## Global Constraints

- Devnet only. Treasury pubkey = service keypair pubkey `2t5SHE9udJWswb5GqKMzvRhE836uyzkdkQJGf1sHhi8p`; FE `VITE_TREASURY_ADDRESS` must equal it; BE derives it from the keyfile so they can't drift.
- `SERVICE_WALLET_SECRET` = path to `.devnet/service-keypair.json` (Solana CLI JSON array keyfile). Read file → `Keypair.fromSecretKey(Uint8Array.from(JSON.parse(...)))`. Never log/commit it.
- `lamports = Math.round(sol * LAMPORTS_PER_SOL)`. `stampedAt` from tx `blockTime*1000`, `epochDay = floor(stampedAt/86_400_000)`, never `Date.now()` for a real stamp.
- Idempotency: claim `resolving→settling` atomically before sending SOL; finalize to `won`/`lost` after.
- Payout decided by off-chain `resolvePrediction`; `verifiedOnChain` is a best-effort stamp, not a gate.
- No LLM trace in commits.

---

# BACKEND (calledit-api, branch feat/onchain-validate-stat)

### Task B1: Service wallet loader

**Files:** Create `src/onchain/serviceWallet.ts`; Test `src/onchain/serviceWallet.test.ts`.

**Interfaces:** Produces `loadServiceKeypair(): Keypair`, `treasuryPubkey(): PublicKey`.

- [ ] **Step 1 — test** (against a temp keyfile fixture)

```ts
// src/onchain/serviceWallet.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, rmSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';
import { loadServiceKeypair, treasuryPubkey } from './serviceWallet.js';

const kp = Keypair.generate();
const path = '/tmp/test-service-keypair.json';

beforeAll(() => {
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
  process.env.SERVICE_WALLET_SECRET = path;
});
afterAll(() => rmSync(path, { force: true }));

describe('serviceWallet', () => {
  it('loads the keypair from a JSON keyfile path', () => {
    expect(loadServiceKeypair().publicKey.toBase58()).toBe(kp.publicKey.toBase58());
  });
  it('treasuryPubkey matches the loaded keypair', () => {
    expect(treasuryPubkey().toBase58()).toBe(kp.publicKey.toBase58());
  });
});
```

- [ ] **Step 2 — run, expect fail** (`pnpm vitest run src/onchain/serviceWallet.test.ts`)
- [ ] **Step 3 — implement**

```ts
// src/onchain/serviceWallet.ts
import { readFileSync } from 'node:fs';
import { Keypair, PublicKey } from '@solana/web3.js';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

let cached: Keypair | undefined;

// SERVICE_WALLET_SECRET is a path to a Solana CLI JSON keyfile ([n,n,...] of 64 bytes).
export function loadServiceKeypair(): Keypair {
  if (cached) return cached;
  const raw = readFileSync(requireEnv('SERVICE_WALLET_SECRET'), 'utf8').trim();
  const bytes = Uint8Array.from(JSON.parse(raw) as number[]);
  cached = Keypair.fromSecretKey(bytes);
  return cached;
}

export function treasuryPubkey(): PublicKey {
  return loadServiceKeypair().publicKey;
}
```

- [ ] **Step 4 — run, expect pass**
- [ ] **Step 5 — commit** `git commit -m "feat: carrega a service wallet devnet do keyfile"`

---

### Task B2: Stake verification + payout send

**Files:** Create `src/onchain/stake.ts`; Test `src/onchain/stake.test.ts`.

**Interfaces:** Consumes `getConnection` (anchor.ts), `treasuryPubkey`/`loadServiceKeypair` (B1). Produces `verifyStakeTransfer(sig, from, lamports): Promise<{ok, blockTime, reason?}>`, `sendPayout(to, lamports): Promise<string>`, `parseTransferMatch(parsedTx, from, treasury, lamports): {ok, reason?}` (pure, extracted for testing).

- [ ] **Step 1 — test the PURE matcher** (parsing is the risk; the RPC calls are integration-only)

```ts
// src/onchain/stake.test.ts
import { describe, it, expect } from 'vitest';
import { parseTransferMatch } from './stake.js';

const from = 'AaAa11111111111111111111111111111111111111Aa';
const treasury = 'Bb2222222222222222222222222222222222222222Bb';

function tx(source: string, destination: string, lamports: number, err: unknown = null) {
  return {
    meta: { err },
    transaction: { message: { instructions: [
      { program: 'system', parsed: { type: 'transfer', info: { source, destination, lamports } } },
    ] } },
  };
}

describe('parseTransferMatch', () => {
  it('accepts a matching transfer', () => {
    expect(parseTransferMatch(tx(from, treasury, 1_000_000), from, treasury, 1_000_000).ok).toBe(true);
  });
  it('rejects wrong destination', () => {
    expect(parseTransferMatch(tx(from, 'CcC', 1_000_000), from, treasury, 1_000_000).ok).toBe(false);
  });
  it('rejects too-few lamports', () => {
    expect(parseTransferMatch(tx(from, treasury, 999), from, treasury, 1_000_000).ok).toBe(false);
  });
  it('rejects a failed tx', () => {
    expect(parseTransferMatch(tx(from, treasury, 1_000_000, { x: 1 }), from, treasury, 1_000_000).ok).toBe(false);
  });
  it('rejects null tx', () => {
    expect(parseTransferMatch(null, from, treasury, 1_000_000).ok).toBe(false);
  });
});
```

- [ ] **Step 2 — run, expect fail**
- [ ] **Step 3 — implement**

```ts
// src/onchain/stake.ts
import {
  SystemProgram, Transaction, PublicKey, LAMPORTS_PER_SOL, sendAndConfirmTransaction,
  type ParsedTransactionWithMeta,
} from '@solana/web3.js';
import { getConnection } from './anchor.js';
import { loadServiceKeypair, treasuryPubkey } from './serviceWallet.js';

export function parseTransferMatch(
  tx: ParsedTransactionWithMeta | null,
  from: string,
  treasury: string,
  lamports: number,
): { ok: boolean; reason?: string } {
  if (!tx) return { ok: false, reason: 'tx not found' };
  if (tx.meta?.err) return { ok: false, reason: 'tx failed on-chain' };
  const ixs = tx.transaction.message.instructions as Array<{
    program?: string; parsed?: { type?: string; info?: { source?: string; destination?: string; lamports?: number } };
  }>;
  const match = ixs.find(
    (i) => i.program === 'system' && i.parsed?.type === 'transfer' &&
      i.parsed.info?.source === from && i.parsed.info?.destination === treasury &&
      (i.parsed.info?.lamports ?? 0) >= lamports,
  );
  return match ? { ok: true } : { ok: false, reason: 'no matching transfer instruction' };
}

export async function verifyStakeTransfer(
  sig: string, from: string, lamports: number,
): Promise<{ ok: boolean; blockTime: number | null; reason?: string }> {
  const conn = getConnection();
  const tx = await conn.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0 });
  const res = parseTransferMatch(tx, from, treasuryPubkey().toBase58(), lamports);
  return { ok: res.ok, blockTime: tx?.blockTime ?? null, reason: res.reason };
}

export async function sendPayout(to: string, lamports: number): Promise<string> {
  const conn = getConnection();
  const kp = loadServiceKeypair();
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(to), lamports }),
  );
  return sendAndConfirmTransaction(conn, tx, [kp]);
}

export const solToLamports = (sol: number): number => Math.round(sol * LAMPORTS_PER_SOL);
```

- [ ] **Step 4 — run, expect pass**
- [ ] **Step 5 — commit** `git commit -m "feat: verifica transfer de stake e envia payout on-chain"`

---

### Task B3: Schema fields

**Files:** Modify `src/schemas/index.ts`.

- [ ] **Step 1** — in `commitPredictionSchema` add `stakeTxSig: z.string().min(1),`. In `settlementSchema` add `payoutTxHash: z.string().optional(),`.
- [ ] **Step 2** — `pnpm type-check`
- [ ] **Step 3 — commit** `git commit -m "feat: adiciona stakeTxSig e payoutTxHash aos schemas"`

---

### Task B4: Verify stake on commit

**Files:** Modify `src/services/predictions.ts`, `src/routes/predictions.ts`.

**Interfaces:** Consumes `verifyStakeTransfer`, `solToLamports` (B2).

- [ ] **Step 1** — in `createPrediction`, before the insert:

```ts
import { verifyStakeTransfer, solToLamports } from '../onchain/stake.js';

const stakeLamports = solToLamports(input.stakeSol);
const stake = await verifyStakeTransfer(input.stakeTxSig, input.address, stakeLamports);
if (!stake.ok) {
  const err = new Error(`stake transfer not verified: ${stake.reason ?? 'unknown'}`);
  (err as Error & { statusCode?: number }).statusCode = 400;
  throw err;
}
const stampedAt = stake.blockTime ? stake.blockTime * 1000 : Date.now();
const seq = 1;
const epochDay = Math.floor(stampedAt / 86_400_000);
const txHash = input.stakeTxSig;
```

(Replace the existing stub `stampedAt/seq/epochDay/txHash` block at `services/predictions.ts:53-57`.)

- [ ] **Step 2** — in `src/routes/predictions.ts`, ensure the POST handler maps a thrown `statusCode===400` to a 400 reply (Fastify uses `error.statusCode` automatically; add an explicit `setErrorHandler` only if the current setup swallows it — verify by reading the route).
- [ ] **Step 3** — `pnpm type-check && pnpm vitest run` (existing prediction tests may need the new `stakeTxSig` in fixtures + a mocked `verifyStakeTransfer` — update them to pass a sig and stub the verifier to `{ok:true, blockTime:...}`).
- [ ] **Step 4 — commit** `git commit -m "feat: exige e verifica a tx de stake ao criar prediction"`

---

### Task B5: Real payout on settlement

**Files:** Modify `src/settlement/worker.ts`.

**Interfaces:** Consumes `sendPayout`, `solToLamports` (B2).

- [ ] **Step 1** — widen the resolving SELECT and `ResolvingRow` to include `address` (and confirm `potential_sol` is available for the payout amount).
- [ ] **Step 2** — in `settleOne`, replace the final persist for a `won` outcome with a claim→pay→finalize sequence:

```ts
import { sendPayout, solToLamports } from '../onchain/stake.js';

if (outcome.status === 'won') {
  // Atomic claim so overlapping ticks can't double-pay.
  const claim = await db.query(
    `update predictions set status='settling' where id=$1 and status='resolving'`, [row.id],
  );
  if (claim.rowCount === 0) return; // already claimed/settled
  try {
    const sig = await sendPayout(row.address, solToLamports(outcome.payoutSol));
    outcome.settlement.payoutTxHash = sig;
  } catch (err) {
    console.error('payout failed, leaving prediction in settling for retry', row.id, err);
    // ponytail: failed send leaves row 'settling'; a later tick re-selects only if we
    // reset to 'resolving'. For the demo we reset here so it retries; durable fix = record intent first.
    await db.query(`update predictions set status='resolving' where id=$1 and status='settling'`, [row.id]);
    return;
  }
}
// finalize (existing update), but match on the claimed status:
await db.query(
  `update predictions set status=$1, settlement=$2 where id=$3 and status in ('resolving','settling')`,
  [outcome.status, outcome.settlement, row.id],
);
```

Keep the existing `verifyStat` on-chain stamp block (in its try/catch) before the finalize.

- [ ] **Step 3** — `pnpm type-check && pnpm vitest run` (settlement tests: mock `sendPayout` to return a fake sig; assert `payoutTxHash` set and no double-pay when run twice).
- [ ] **Step 4 — commit** `git commit -m "feat: paga o vencedor com transfer real no settlement"`

---

# FRONTEND (called-it, new branch feat/real-stake from master)

### Task F1: Dependency + treasury config

**Files:** `package.json` (add `@solana/web3.js`), `src/shared/config.ts`, `.env.example`.

- [ ] Add `@solana/web3.js` (`pnpm add @solana/web3.js` in called-it).
- [ ] In `src/shared/config.ts` add `export const TREASURY_ADDRESS = import.meta.env.VITE_TREASURY_ADDRESS ?? '2t5SHE9udJWswb5GqKMzvRhE836uyzkdkQJGf1sHhi8p';`
- [ ] In `.env.example` add `VITE_TREASURY_ADDRESS=2t5SHE9udJWswb5GqKMzvRhE836uyzkdkQJGf1sHhi8p`.
- [ ] Commit `git commit -m "feat: adiciona web3.js e endereco da treasury"`

---

### Task F2: Phantom transfer helper

**Files:** Modify `src/entities/wallet/adapters.ts` (extend `SolanaProvider`); Create `src/shared/lib/solana-transfer.ts`.

- [ ] Extend `SolanaProvider` (adapters.ts:12-15) with:

```ts
  publicKey?: { toString(): string };
  signAndSendTransaction?(tx: unknown): Promise<{ signature: string }>;
```

- [ ] Create `src/shared/lib/solana-transfer.ts`:

```ts
import { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { SOLANA_RPC_URL, TREASURY_ADDRESS } from '../config';
import { detectPhantom } from '../../entities/wallet/adapters';

// Signs + sends a real devnet SOL transfer from the connected Phantom wallet to the treasury.
export async function signStakeTransfer(from: string, sol: number): Promise<string> {
  const provider = detectPhantom();
  if (!provider?.signAndSendTransaction) throw new Error('Phantom não suporta assinatura de transação');
  const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
  const fromPubkey = new PublicKey(from);
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey,
      toPubkey: new PublicKey(TREASURY_ADDRESS),
      lamports: Math.round(sol * LAMPORTS_PER_SOL),
    }),
  );
  tx.feePayer = fromPubkey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const { signature } = await provider.signAndSendTransaction(tx);
  await connection.confirmTransaction(signature, 'confirmed');
  return signature;
}
```

(Confirm `detectPhantom` is exported from `adapters.ts`; if it returns the raw provider use it, else adapt to the existing export.)

- [ ] `pnpm type-check` (or `tsc --noEmit` / the repo's check).
- [ ] Commit `git commit -m "feat: helper de transfer de stake assinado na phantom"`

---

### Task F3: Wire the real stake into the commit funnel

**Files:** Modify `src/shared/api/client.ts` (`CommitPredictionInput` + POST body), `src/features/prediction.ts` (`useMakePrediction`).

- [ ] In `client.ts` add `stakeTxSig: string` to `CommitPredictionInput` (line 34-39) and include it in the POST body (line 54-57).
- [ ] In `src/features/prediction.ts` `mutationFn` (line 19-27), before `api.commitPrediction`:

```ts
import { signStakeTransfer } from '../shared/lib/solana-transfer';

// inside mutationFn, address already required:
const stakeTxSig = await signStakeTransfer(address, input.stakeSol);
const prediction = await api.commitPrediction({ matchId, market: input.market, stakeSol: input.stakeSol, address, stakeTxSig });
```

Surface a clear error if `signStakeTransfer` throws (user rejected Phantom / no funds).

- [ ] `pnpm type-check`.
- [ ] Commit `git commit -m "feat: assina o stake real antes de comprometer a prediction"`

---

## Verification (live acceptance, needs Phantom + funded user wallet)

1. Backend deployed/running on devnet with the funded service wallet; `TXORACLE_SCORES_ROOTS` set (from the validate_stat task).
2. Frontend `VITE_TREASURY_ADDRESS` = service pubkey, `VITE_SOLANA_RPC_URL` = devnet.
3. On the live match: connect Phantom (funded with devnet SOL), pick a market, CALL IT → Phantom prompts → sign → real stake tx on explorer → prediction shows the real signature.
4. When the market resolves: winner receives a real payout tx; `GET /api/predictions/:id` shows `settlement.payoutTxHash` + `verifiedOnChain`.

## Self-Review

- Spec coverage: service wallet (B1), stake verify + payout (B2), schemas (B3), commit-verify (B4), settlement payout (B5); FE deps+config (F1), Phantom helper (F2), funnel wiring (F3). All spec components covered.
- Placeholders: none — each task has runnable code. The idempotency ceiling is explicitly marked with a `ponytail:` comment, not left as TODO.
- Type consistency: `verifyStakeTransfer`/`sendPayout`/`solToLamports`/`signStakeTransfer`/`stakeTxSig`/`payoutTxHash` names consistent across BE and FE tasks.
