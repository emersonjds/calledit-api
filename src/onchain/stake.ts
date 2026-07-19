import {
  SystemProgram, Transaction, PublicKey, LAMPORTS_PER_SOL, sendAndConfirmTransaction,
} from '@solana/web3.js';
import { getConnection } from './anchor.js';
import { loadServiceKeypair, treasuryPubkey } from './serviceWallet.js';

// Structural subset of ParsedTransactionWithMeta — only what the matcher reads.
// Keeps the pure matcher testable with plain fixtures instead of the full RPC shape.
interface MatchableTx {
  meta: { err: unknown } | null;
  transaction: {
    message: {
      instructions: Array<{
        program?: string;
        parsed?: { type?: string; info?: { source?: string; destination?: string; lamports?: number } };
      }>;
    };
  };
}

export function parseTransferMatch(
  tx: MatchableTx | null,
  from: string,
  treasury: string,
  lamports: number,
): { ok: boolean; reason?: string } {
  if (!tx) return { ok: false, reason: 'tx not found' };
  if (tx.meta?.err) return { ok: false, reason: 'tx failed on-chain' };
  const ixs = tx.transaction.message.instructions;
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
  // RPC's parsed-instruction union isn't structurally narrower than what the matcher reads;
  // cast to the matcher's minimal shape rather than widen it to the full RPC union.
  const res = parseTransferMatch(tx as unknown as MatchableTx | null, from, treasuryPubkey().toBase58(), lamports);
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
