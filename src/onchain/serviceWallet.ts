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
