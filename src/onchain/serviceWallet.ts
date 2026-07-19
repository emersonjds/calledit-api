import { readFileSync } from 'node:fs';
import { Keypair, PublicKey } from '@solana/web3.js';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

let cached: Keypair | undefined;

// SERVICE_WALLET_SECRET is either a Solana CLI JSON keyfile *path*, or the JSON
// array itself inline (starts with '['). The inline form lets hosts like Railway
// hold the key as an env var without shipping the gitignored keyfile.
export function loadServiceKeypair(): Keypair {
  if (cached) return cached;
  const value = requireEnv('SERVICE_WALLET_SECRET').trim();
  const json = value.startsWith('[') ? value : readFileSync(value, 'utf8').trim();
  const bytes = Uint8Array.from(JSON.parse(json) as number[]);
  cached = Keypair.fromSecretKey(bytes);
  return cached;
}

export function treasuryPubkey(): PublicKey {
  return loadServiceKeypair().publicKey;
}
