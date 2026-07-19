import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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

  it('loads the keypair from an inline JSON array (Railway env form)', async () => {
    const inlineKp = Keypair.generate();
    vi.resetModules();
    process.env.SERVICE_WALLET_SECRET = JSON.stringify(Array.from(inlineKp.secretKey));
    const fresh = await import('./serviceWallet.js');
    expect(fresh.loadServiceKeypair().publicKey.toBase58()).toBe(inlineKp.publicKey.toBase58());
    process.env.SERVICE_WALLET_SECRET = path;
  });
});
