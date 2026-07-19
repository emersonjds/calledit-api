import { PublicKey } from '@solana/web3.js';
import { getTxoracle } from './anchor.js';
import { buildValidateStatArgs, epochDayFromTs, type Predicate } from './args.js';
import type { ScoresStatValidationV3 } from '../txline/proof.js';

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
  let ok: boolean;
  try {
    ok = (await program.methods
      .validateStat(...args)
      .accounts({ dailyScoresMerkleRoots: rootsAccount })
      .view()) as boolean;
  } catch (err) {
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
