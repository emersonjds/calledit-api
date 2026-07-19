import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// CommonJS module: named ESM imports fail to boot under node 22 (Railway).
import anchorPkg from '@coral-xyz/anchor';
import type { Idl } from '@coral-xyz/anchor';
const { AnchorProvider, Program } = anchorPkg;
type Program = InstanceType<typeof Program>;
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
