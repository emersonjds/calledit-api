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
  return { ok, proofId, epochDay: epochDayFromTs(proof.ts) };
}
