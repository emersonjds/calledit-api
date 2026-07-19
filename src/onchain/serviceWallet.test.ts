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
