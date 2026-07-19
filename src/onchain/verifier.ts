import { PublicKey } from '@solana/web3.js';
import { getTxoracle } from './anchor.js';
import { buildValidateStatArgs, epochDayFromTs, type Predicate } from './args.js';
import type { ScoresStatValidationV3 } from '../txline/proof.js';

// `daily_scores_roots` is a per-day PDA, not a singleton: seeds = ["daily_scores_roots", epochDay as u16 LE].
// Confirmed on devnet by deriving these seeds and finding real, already-rooted accounts at the
// resulting addresses (epochDay 20648/20649/20652 all exist on-chain with this exact derivation).
export function resolveScoresRootsAccount(epochDay: number, programId: PublicKey): PublicKey {
  const fromEnv = process.env.TXORACLE_SCORES_ROOTS;
  if (fromEnv) return new PublicKey(fromEnv);
  const dayBuf = Buffer.alloc(2);
  dayBuf.writeUInt16LE(epochDay);
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from('daily_scores_roots'), dayBuf], programId);
  return pda;
}

export async function verifyStat(
  proof: ScoresStatValidationV3,
  predicate: Predicate,
): Promise<{ ok: boolean; proofId: string; epochDay: number }> {
  const program = getTxoracle();
  const epochDay = epochDayFromTs(proof.ts);
  const rootsAccount = resolveScoresRootsAccount(epochDay, program.programId);
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
    // Narrow on purpose: only the "IDL has no return type" case falls back to .simulate().
    // A bare /view/i match would also swallow real RPC/simulation errors that merely mention "view".
    if (!/does not have a return type/i.test(String(err))) throw err;
    const sim = await program.methods
      .validateStat(...args)
      .accounts({ dailyScoresMerkleRoots: rootsAccount })
      .simulate();
    const ret = sim.raw.find((l) => l.startsWith('Program return:'));
    ok = ret ? Buffer.from(ret.split(' ').pop() ?? '', 'base64')[0] === 1 : false;
  }
  const proofId = `${proof.summary.fixtureId}:${proof.ts}`;
  return { ok, proofId, epochDay };
}
