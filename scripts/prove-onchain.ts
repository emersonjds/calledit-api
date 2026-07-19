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
