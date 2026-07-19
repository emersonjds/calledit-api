# On-chain `validate_stat` de-risk — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fetch a real TxLINE Merkle proof, call `txoracle.validate_stat` on devnet via Anchor `.view()`, read the boolean it returns, and record that boolean in settlement.

**Architecture:** Pure-TS pipeline. `feed_events` gives real `(fixtureId, seq)` → `/scores/stat-validation-v3` proof → map to `validate_stat` args (IDL is authority) → `Program.view()` → boolean. A CLI de-risk script is the acceptance artifact; settlement records the boolean as `verifiedOnChain`.

**Tech Stack:** `@coral-xyz/anchor` 0.32, `@solana/web3.js` 1.98, `pg`, `zod` 4, `vitest`, `tsx`. Node 22.

## Global Constraints

- `seq` ≥ 1 (seq=0 rejected on-chain); taken from the feed/proof, never `Date.now()`.
- `epochDay = Math.floor(proof.ts / 86_400_000)` — from the proof `ts`, never the clock.
- One network only. Test = **devnet**: `NETWORK=devnet`, RPC `https://api.devnet.solana.com`, `TXORACLE_PROGRAM_ID=6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`, `TXLINE_API_ORIGIN=https://txline-dev.txodds.com`. Mixing networks → 403.
- Devnet service wallet: `2t5SHE9udJWswb5GqKMzvRhE836uyzkdkQJGf1sHhi8p` (must hold devnet SOL; `.view()` itself needs no funds but the provider wallet must be a valid pubkey).
- The exact instruction args/accounts come from `idl/txoracle.json`. `validate_stat` args: `ts:i64`, `fixture_summary:ScoresBatchSummary`, `fixture_proof:ProofNode[]`, `main_tree_proof:ProofNode[]`, `predicate:TraderPredicate`, `stat_a:StatTerm`, `stat_b:StatTerm?`, `op:BinaryExpression?`. Accounts: one — `daily_scores_merkle_roots` (plain, read-only).
- IDL type shapes: `ProofNode{ hash:[u8;32], is_right_sibling:bool }`; `StatTerm{ stat_to_prove:ScoreStat, event_stat_root:[u8;32], stat_proof:ProofNode[] }`; `ScoreStat{ key:u32, value:i32, period:i32 }`; `ScoresBatchSummary{ fixture_id:i64, update_stats:ScoresUpdateStats, events_sub_tree_root:[u8;32] }`; `ScoresUpdateStats{ update_count:i32, min_timestamp:i64, max_timestamp:i64 }`; `TraderPredicate{ threshold:i32, comparison:Comparison }`; `Comparison` enum `{GreaterThan,LessThan,EqualTo}`; `BinaryExpression` enum `{Add,Subtract}`.
- Commits: micro, conventional-commit, lowercase, Portuguese, no trailing period. No `Co-Authored-By`, no emoji, no mention of Claude/AI. Author = Emerson (git config already correct).

## File Structure

- **Create** `src/txline/proof.ts` — `ScoresStatValidationV3` types + `statProofPath()` + `fetchStatProof()`.
- **Create** `src/onchain/anchor.ts` — `getTxoracle()`: read-only `Program` from IDL at devnet program id.
- **Create** `src/onchain/args.ts` — `buildValidateStatArgs(proof, predicate)`: pure map proof→IDL args + byte helpers.
- **Create** `src/onchain/verifier.ts` — `resolveScoresRootsAccount()` + `verifyStat(proof, predicate)`.
- **Create** `scripts/prove-onchain.ts` — CLI de-risk artifact.
- **Modify** `src/schemas/index.ts` — add `verifiedOnChain?: boolean` to `settlementSchema`.
- **Modify** `src/settlement/worker.ts` — call `verifyStat` on resolution, stamp `verifiedOnChain`.
- **Test** `src/onchain/args.test.ts`, `src/txline/proof.test.ts`.

---

### Task 1: Proof endpoint — path builder + fetch

**Files:**
- Create: `src/txline/proof.ts`
- Test: `src/txline/proof.test.ts`

**Interfaces:**
- Consumes: `txlineGet(path)` from `src/txline/api.ts`.
- Produces: `statProofPath(fixtureId:number, seq:number, statKeys:string):string`; `fetchStatProof(fixtureId:number, seq:number, statKeys:string):Promise<ScoresStatValidationV3>`; types `ScoresStatValidationV3`, `ProofNodeJson`, `StatLeafJson`, `ScoreStatJson`, `ScoresBatchSummaryJson`.

- [ ] **Step 1: Write the failing test**

```ts
// src/txline/proof.test.ts
import { describe, it, expect } from 'vitest';
import { statProofPath } from './proof.js';

describe('statProofPath', () => {
  it('builds the v3 endpoint with query params', () => {
    expect(statProofPath(12345, 1, '1')).toBe(
      '/api/scores/stat-validation-v3?fixtureId=12345&seq=1&statKeys=1',
    );
  });
  it('passes multiple stat keys verbatim', () => {
    expect(statProofPath(9, 3, '1,3,7')).toBe(
      '/api/scores/stat-validation-v3?fixtureId=9&seq=3&statKeys=1%2C3%2C7',
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/txline/proof.test.ts`
Expected: FAIL — cannot find module `./proof.js` / `statProofPath` not exported.

- [ ] **Step 3: Implement**

```ts
// src/txline/proof.ts
import { txlineGet } from './api.js';

export interface ScoreStatJson { key: number; value: number; period: number }
export interface ProofNodeJson { hash: string; isRightSibling: boolean }
export interface StatLeafJson { stat: ScoreStatJson; statProof: ProofNodeJson[]; eventStatRoot: string }
export interface ScoresBatchSummaryJson {
  fixtureId: number;
  updateStats: { updateCount: number; minTimestamp: number; maxTimestamp: number };
  eventStatsSubTreeRoot: string;
}
export interface ScoresStatValidationV3 {
  ts: number;
  summary: ScoresBatchSummaryJson;
  eventStatRoot: string;
  statsToProve: StatLeafJson[];
  subTreeProof: ProofNodeJson[];
  mainTreeProof: ProofNodeJson[];
}

export function statProofPath(fixtureId: number, seq: number, statKeys: string): string {
  const q = new URLSearchParams({ fixtureId: String(fixtureId), seq: String(seq), statKeys });
  return `/api/scores/stat-validation-v3?${q.toString()}`;
}

export async function fetchStatProof(
  fixtureId: number,
  seq: number,
  statKeys: string,
): Promise<ScoresStatValidationV3> {
  return (await txlineGet(statProofPath(fixtureId, seq, statKeys))) as ScoresStatValidationV3;
}
```

Note: field names (`isRightSibling`, `eventStatsSubTreeRoot`, `statProof`) are the doc's JSON names; if the live payload differs, adjust the interface to the real keys and re-run the de-risk script (Task 5). Binary fields are strings here (base64 assumed) and decoded in Task 2.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/txline/proof.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/txline/proof.ts src/txline/proof.test.ts
git commit -m "feat: busca do proof stat-validation-v3"
```

---

### Task 2: Proof → `validate_stat` args (pure mapper)

**Files:**
- Create: `src/onchain/args.ts`
- Test: `src/onchain/args.test.ts`

**Interfaces:**
- Consumes: `ScoresStatValidationV3`, `ProofNodeJson`, `StatLeafJson` from `src/txline/proof.js`.
- Produces: `toBytes32(b64:string):number[]`; `Predicate = { threshold:number; comparison:'GreaterThan'|'LessThan'|'EqualTo' }`; `buildValidateStatArgs(proof:ScoresStatValidationV3, predicate:Predicate):ValidateStatArgs`; `epochDayFromTs(ts:number):number`. `ValidateStatArgs` = the positional tuple Anchor `.methods.validateStat(...)` expects.

- [ ] **Step 1: Write the failing test**

```ts
// src/onchain/args.test.ts
import { describe, it, expect } from 'vitest';
import { toBytes32, epochDayFromTs, buildValidateStatArgs } from './args.js';
import type { ScoresStatValidationV3 } from '../txline/proof.js';

const b64 = (n: number) => Buffer.alloc(32, n).toString('base64');

const proof: ScoresStatValidationV3 = {
  ts: 1_700_000_000_000,
  summary: {
    fixtureId: 42,
    updateStats: { updateCount: 3, minTimestamp: 1, maxTimestamp: 9 },
    eventStatsSubTreeRoot: b64(7),
  },
  eventStatRoot: b64(5),
  statsToProve: [{ stat: { key: 1, value: 2, period: 0 }, statProof: [{ hash: b64(1), isRightSibling: true }], eventStatRoot: b64(5) }],
  subTreeProof: [{ hash: b64(2), isRightSibling: false }],
  mainTreeProof: [{ hash: b64(3), isRightSibling: true }],
};

describe('toBytes32', () => {
  it('decodes a 32-byte base64 blob to a 32-length array', () => {
    const out = toBytes32(b64(9));
    expect(out).toHaveLength(32);
    expect(out.every((x) => x === 9)).toBe(true);
  });
  it('rejects wrong-length blobs', () => {
    expect(() => toBytes32(Buffer.alloc(31).toString('base64'))).toThrow();
  });
});

describe('epochDayFromTs', () => {
  it('derives epoch day from the proof ts, not the clock', () => {
    expect(epochDayFromTs(1_700_000_000_000)).toBe(Math.floor(1_700_000_000_000 / 86_400_000));
  });
});

describe('buildValidateStatArgs', () => {
  it('maps proof + predicate into positional validate_stat args', () => {
    const [ts, summary, fixtureProof, mainTreeProof, predicate, statA, statB, op] =
      buildValidateStatArgs(proof, { threshold: 1, comparison: 'GreaterThan' });
    expect(ts.toString()).toBe('1700000000000');
    expect(summary.fixtureId.toString()).toBe('42');
    expect(summary.eventsSubTreeRoot).toHaveLength(32);
    expect(fixtureProof).toHaveLength(1);
    expect(fixtureProof[0].isRightSibling).toBe(false);
    expect(mainTreeProof[0].isRightSibling).toBe(true);
    expect(predicate).toEqual({ threshold: 1, comparison: { greaterThan: {} } });
    expect(statA.statToProve.key).toBe(1);
    expect(statA.statProof).toHaveLength(1);
    expect(statB).toBeNull();
    expect(op).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/onchain/args.test.ts`
Expected: FAIL — module `./args.js` not found.

- [ ] **Step 3: Implement**

```ts
// src/onchain/args.ts
import { BN } from '@coral-xyz/anchor';
import type { ScoresStatValidationV3, ProofNodeJson, StatLeafJson } from '../txline/proof.js';

export interface Predicate {
  threshold: number;
  comparison: 'GreaterThan' | 'LessThan' | 'EqualTo';
}

// TxLINE serialises 32-byte hashes as base64. If the live payload is hex,
// switch to Buffer.from(b64, 'hex') — the de-risk script surfaces a length error first.
export function toBytes32(b64: string): number[] {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length !== 32) throw new Error(`expected 32-byte hash, got ${buf.length}`);
  return Array.from(buf);
}

export function epochDayFromTs(ts: number): number {
  return Math.floor(ts / 86_400_000);
}

// Anchor camelCases IDL field names and represents enums as { variantCamel: {} }.
const COMPARISON = {
  GreaterThan: { greaterThan: {} },
  LessThan: { lessThan: {} },
  EqualTo: { equalTo: {} },
} as const;

function proofNode(n: ProofNodeJson): { hash: number[]; isRightSibling: boolean } {
  return { hash: toBytes32(n.hash), isRightSibling: n.isRightSibling };
}

function statTerm(leaf: StatLeafJson): {
  statToProve: { key: number; value: number; period: number };
  eventStatRoot: number[];
  statProof: { hash: number[]; isRightSibling: boolean }[];
} {
  return {
    statToProve: { key: leaf.stat.key, value: leaf.stat.value, period: leaf.stat.period },
    eventStatRoot: toBytes32(leaf.eventStatRoot),
    statProof: leaf.statProof.map(proofNode),
  };
}

// Positional tuple for program.methods.validateStat(...args)
export type ValidateStatArgs = [
  BN,
  { fixtureId: BN; updateStats: { updateCount: number; minTimestamp: BN; maxTimestamp: BN }; eventsSubTreeRoot: number[] },
  { hash: number[]; isRightSibling: boolean }[],
  { hash: number[]; isRightSibling: boolean }[],
  { threshold: number; comparison: (typeof COMPARISON)[keyof typeof COMPARISON] },
  ReturnType<typeof statTerm>,
  ReturnType<typeof statTerm> | null,
  null,
];

export function buildValidateStatArgs(
  proof: ScoresStatValidationV3,
  predicate: Predicate,
): ValidateStatArgs {
  const s = proof.summary;
  return [
    new BN(proof.ts),
    {
      fixtureId: new BN(s.fixtureId),
      updateStats: {
        updateCount: s.updateStats.updateCount,
        minTimestamp: new BN(s.updateStats.minTimestamp),
        maxTimestamp: new BN(s.updateStats.maxTimestamp),
      },
      eventsSubTreeRoot: toBytes32(s.eventStatsSubTreeRoot),
    },
    proof.subTreeProof.map(proofNode),
    proof.mainTreeProof.map(proofNode),
    { threshold: predicate.threshold, comparison: COMPARISON[predicate.comparison] },
    statTerm(proof.statsToProve[0]),
    proof.statsToProve[1] ? statTerm(proof.statsToProve[1]) : null,
    null,
  ];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/onchain/args.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/onchain/args.ts src/onchain/args.test.ts
git commit -m "feat: mapeia proof v3 para args do validate_stat"
```

---

### Task 3: Anchor program loader (read-only)

**Files:**
- Create: `src/onchain/anchor.ts`

**Interfaces:**
- Consumes: `env` (`SOLANA_RPC_URL`, `TXORACLE_PROGRAM_ID`) via `process.env`.
- Produces: `getTxoracle(): Program` (Anchor `Program` built from `idl/txoracle.json`); `getConnection(): Connection`.

- [ ] **Step 1: Implement (no unit test — thin wiring, covered by Task 5 live run)**

```ts
// src/onchain/anchor.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AnchorProvider, Program, type Idl } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';

const here = dirname(fileURLToPath(import.meta.url));
const idl = JSON.parse(readFileSync(join(here, '../../idl/txoracle.json'), 'utf8')) as Idl;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

export function getConnection(): Connection {
  return new Connection(requireEnv('SOLANA_RPC_URL'), 'confirmed');
}

// Read-only provider: .view() simulates, so a throwaway keypair as the wallet is fine.
export function getTxoracle(): Program {
  const connection = getConnection();
  const wallet = {
    publicKey: Keypair.generate().publicKey,
    signTransaction: async (t: unknown) => t,
    signAllTransactions: async (t: unknown) => t,
  };
  const provider = new AnchorProvider(connection, wallet as never, { commitment: 'confirmed' });
  const programId = new PublicKey(requireEnv('TXORACLE_PROGRAM_ID'));
  return new Program({ ...idl, address: programId.toBase58() } as Idl, provider);
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm type-check`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/onchain/anchor.ts
git commit -m "feat: carrega o programa txoracle read-only via anchor"
```

---

### Task 4: Resolve roots account + `verifyStat` (spike → implement)

**Files:**
- Create: `src/onchain/verifier.ts`

**Interfaces:**
- Consumes: `getTxoracle`, `getConnection` (Task 3); `buildValidateStatArgs`, `epochDayFromTs`, `Predicate` (Task 2); `ScoresStatValidationV3` (Task 1).
- Produces: `resolveScoresRootsAccount(proof):Promise<PublicKey>`; `verifyStat(proof:ScoresStatValidationV3, predicate:Predicate):Promise<{ ok:boolean; proofId:string; epochDay:number }>`.

**Spike first (investigative — `daily_scores_merkle_roots` is a plain, non-PDA account with no address in any doc):**

The account that `insert_scores_root` writes as `daily_scores_roots` is the same account `validate_stat` reads. It has no PDA seeds in the IDL, so resolve it at runtime against devnet program `6pW64…`:

1. `getProgramAccounts(programId)` and inspect account sizes/first-8-byte discriminators.
2. Identify the scores-roots account (the one whose data contains the `mainTreeProof` terminal root, or the single largest roots-style account). Log candidates.
3. Hardcode the resolved devnet pubkey as `DEVNET_SCORES_ROOTS` once confirmed by a passing `.view()`.

Record the resolved address back into this plan and `.env` (`TXORACLE_SCORES_ROOTS`) so it is not rediscovered every run.

- [ ] **Step 1: Implement with env override + discovery fallback**

```ts
// src/onchain/verifier.ts
import { PublicKey } from '@solana/web3.js';
import { getTxoracle, getConnection } from './anchor.js';
import { buildValidateStatArgs, epochDayFromTs, type Predicate } from './args.js';
import type { ScoresStatValidationV3 } from '../txline/proof.js';

// Set once the spike confirms it (also accepted via env TXORACLE_SCORES_ROOTS).
const KNOWN_SCORES_ROOTS: string | undefined = undefined;

export async function resolveScoresRootsAccount(): Promise<PublicKey> {
  const fromEnv = process.env.TXORACLE_SCORES_ROOTS ?? KNOWN_SCORES_ROOTS;
  if (fromEnv) return new PublicKey(fromEnv);
  // Discovery fallback: list program accounts so the spike can identify the roots account.
  const program = getTxoracle();
  const accts = await getConnection().getProgramAccounts(program.programId);
  const sorted = [...accts].sort((a, b) => b.account.data.length - a.account.data.length);
  for (const a of sorted.slice(0, 10)) {
    // eslint-disable-next-line no-console
    console.log('candidate roots account', a.pubkey.toBase58(), 'bytes', a.account.data.length);
  }
  throw new Error(
    'TXORACLE_SCORES_ROOTS not set — pick the roots account from the candidates above and set it in .env',
  );
}

export async function verifyStat(
  proof: ScoresStatValidationV3,
  predicate: Predicate,
): Promise<{ ok: boolean; proofId: string; epochDay: number }> {
  const program = getTxoracle();
  const rootsAccount = await resolveScoresRootsAccount();
  const args = buildValidateStatArgs(proof, predicate);
  // validate_stat returns bool. If IDL lacks `returns`, .view() throws — fall back to .simulate()
  // and read the last "Program return:" datum (base64 → first byte === 1).
  let ok: boolean;
  try {
    ok = (await program.methods
      .validateStat(...args)
      .accounts({ dailyScoresMerkleRoots: rootsAccount })
      .view()) as boolean;
  } catch (err) {
    if (!/does not have a return type|view/i.test(String(err))) throw err;
    const sim = await program.methods
      .validateStat(...args)
      .accounts({ dailyScoresMerkleRoots: rootsAccount })
      .simulate();
    const ret = sim.raw.find((l) => l.startsWith('Program return:'));
    ok = ret ? Buffer.from(ret.split(' ').pop() ?? '', 'base64')[0] === 1 : false;
  }
  const proofId = `${proof.summary.fixtureId}:${proof.ts}`;
  return { ok, proofId, epochDay: epochDayFromTs(proof.ts) };
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm type-check`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/onchain/verifier.ts
git commit -m "feat: verifyStat chama validate_stat e le o boolean on-chain"
```

---

### Task 5: De-risk CLI — the acceptance artifact

**Files:**
- Create: `scripts/prove-onchain.ts`

**Interfaces:**
- Consumes: `fetchStatProof` (Task 1), `verifyStat` (Task 4), `pg` `Pool` + `env`.

- [ ] **Step 1: Implement**

```ts
// scripts/prove-onchain.ts
import 'dotenv/config';
import { Pool } from 'pg';
import { fetchStatProof } from '../src/txline/proof.js';
import { verifyStat } from '../src/onchain/verifier.js';
import type { Predicate } from '../src/onchain/args.js';

// Usage: pnpm tsx scripts/prove-onchain.ts <fixtureId> <seq> <statKeys> [threshold] [GreaterThan|LessThan|EqualTo]
async function main(): Promise<void> {
  let [fixtureId, seq, statKeys, threshold, comparison] = process.argv.slice(2);

  if (!fixtureId) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const { rows } = await pool.query(
      `select fixture_id, seq from feed_events where kind='score' order by ts desc limit 1`,
    );
    await pool.end();
    if (!rows[0]) throw new Error('no recorded score events — run the ingester on devnet first');
    fixtureId = String(rows[0].fixture_id);
    seq = String(rows[0].seq);
    statKeys = statKeys ?? '1';
    console.log(`using latest recorded event fixtureId=${fixtureId} seq=${seq}`);
  }

  const predicate: Predicate = {
    threshold: Number(threshold ?? 0),
    comparison: (comparison as Predicate['comparison']) ?? 'GreaterThan',
  };
  const proof = await fetchStatProof(Number(fixtureId), Number(seq), statKeys ?? '1');
  const result = await verifyStat(proof, predicate);
  console.log(`✓ on-chain validate_stat = ${result.ok}  (proofId=${result.proofId}, epochDay=${result.epochDay})`);
}

main().catch((e) => {
  console.error('✗ de-risk failed:', e);
  process.exit(1);
});
```

- [ ] **Step 2: Run against devnet (acceptance)**

Precondition: `.env` points all-devnet (Global Constraints), the devnet service wallet holds SOL, the ingester has recorded at least one devnet score event, and `TXORACLE_SCORES_ROOTS` is set (from the Task 4 spike).

Run: `pnpm tsx scripts/prove-onchain.ts`
Expected: prints `✓ on-chain validate_stat = true` or `false` (a real boolean from the chain). Any throw here is a real integration finding — resolve (root account, field names, base64-vs-hex, network) and re-run.

- [ ] **Step 3: Commit**

```bash
git add scripts/prove-onchain.ts
git commit -m "feat: script de prova on-chain do validate_stat"
```

---

### Task 6: Wire the boolean into settlement

**Files:**
- Modify: `src/schemas/index.ts` (add `verifiedOnChain` to `settlementSchema`)
- Modify: `src/settlement/worker.ts` (call `verifyStat` on resolution, stamp the flag)

**Interfaces:**
- Consumes: `verifyStat` (Task 4), `fetchStatProof` (Task 1).
- Produces: `Settlement.verifiedOnChain?: boolean` surfaced through `GET /api/predictions/:id`.

- [ ] **Step 1: Add the schema field**

In `src/schemas/index.ts`, inside `settlementSchema = z.object({ ... })`, add:

```ts
  verifiedOnChain: z.boolean().optional(),
```

- [ ] **Step 2: Stamp it when a provable prediction settles**

In `src/settlement/worker.ts`, after the off-chain outcome is computed for a `won`/`lost` provable prediction, fetch the proof for that fixture/seq and attach the on-chain boolean. Wrap in try/catch so a proof/network failure never blocks off-chain settlement (it stays the fallback):

```ts
import { fetchStatProof } from '../txline/proof.js';
import { verifyStat } from '../onchain/verifier.js';

// … where `outcome.settlement` is built for a provable prediction with a known statKey and seq:
try {
  const proof = await fetchStatProof(fixtureId, seq, statKey);
  const chain = await verifyStat(proof, { threshold: 0, comparison: 'GreaterThan' });
  outcome.settlement.verifiedOnChain = chain.ok;
} catch (err) {
  console.warn('on-chain verify skipped:', err instanceof Error ? err.message : err);
}
```

(Use the fixtureId/seq/statKey the worker already has for the resolving prediction; if the worker doesn't currently carry `seq`/`statKey`, thread them from the prediction row — they exist in `predictions`/`feed_events`.)

- [ ] **Step 3: Type-check + tests**

Run: `pnpm type-check && pnpm vitest run`
Expected: no type errors; existing settlement tests still pass (the new field is optional).

- [ ] **Step 4: Commit**

```bash
git add src/schemas/index.ts src/settlement/worker.ts
git commit -m "feat: grava verifiedOnChain no settlement"
```

---

## Self-Review

- **Spec coverage:** proof fetch (T1), arg mapping (T2), program loader (T3), verifyStat + root-account resolution (T4), de-risk script (T5), settlement wiring + schema (T6). All spec sections covered.
- **Placeholders:** none — every step has runnable code/commands. Task 4's spike is a real discovery procedure with a concrete fallback, not a TODO.
- **Type consistency:** `buildValidateStatArgs`/`verifyStat`/`fetchStatProof`/`Predicate` names and signatures match across tasks. Enum shape `{ greaterThan: {} }` matches Anchor's camelCase convention.
- **Known runtime risks (flagged, resolved during T4/T5, not silently):** roots-account address, `.view()` vs `.simulate()`, base64-vs-hex hashes, live JSON field names. Each surfaces as an explicit error in the de-risk script.
