import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import nacl from 'tweetnacl';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotent,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';

const DEVNET = {
  rpc: 'https://api.devnet.solana.com',
  apiOrigin: 'https://txline-dev.txodds.com',
  programId: '6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J',
  txlMint: '4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG',
};
const SERVICE_LEVEL_ID = 1;
const DURATION_WEEKS = 4;
const SELECTED_LEAGUES: number[] = [];
const KEYPAIR_PATH = '.devnet/service-keypair.json';

function loadKeypair(path: string): Keypair {
  const secret: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(secret)) {
    throw new Error(`Keypair at ${path} is not a byte array`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(secret.map(Number)));
}

function readToken(payload: unknown): string {
  if (typeof payload === 'string') {
    return payload;
  }
  if (payload && typeof payload === 'object' && 'token' in payload) {
    const token = (payload as { token: unknown }).token;
    if (typeof token === 'string') {
      return token;
    }
  }
  throw new Error(`Unexpected token response: ${JSON.stringify(payload)}`);
}

async function postJson(url: string, body?: unknown, bearer?: string): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearer) {
    headers.Authorization = `Bearer ${bearer}`;
  }
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`POST ${url} → ${response.status}: ${text}`);
  }
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function main(): Promise<void> {
  const wallet = loadKeypair(KEYPAIR_PATH);
  console.log('service wallet:', wallet.publicKey.toBase58());

  console.log('1/4 guest jwt...');
  const jwt = readToken(await postJson(`${DEVNET.apiOrigin}/auth/guest/start`));
  console.log('    jwt acquired');

  console.log('2/4 subscribe on-chain (SL', SERVICE_LEVEL_ID, ',', DURATION_WEEKS, 'weeks)...');
  const connection = new Connection(DEVNET.rpc, 'confirmed');
  const provider = new AnchorProvider(connection, new Wallet(wallet), { commitment: 'confirmed' });
  const idl = JSON.parse(readFileSync('idl/txoracle.json', 'utf8'));
  const program = new Program(idl, provider);
  const programId = new PublicKey(DEVNET.programId);
  const txlMint = new PublicKey(DEVNET.txlMint);

  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_treasury_v2')],
    programId,
  );
  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('pricing_matrix')],
    programId,
  );
  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    txlMint,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const userTokenAccount = getAssociatedTokenAddressSync(
    txlMint,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  console.log('    ensuring user TxL ATA exists...');
  await createAssociatedTokenAccountIdempotent(
    connection,
    wallet,
    txlMint,
    wallet.publicKey,
    { commitment: 'confirmed' },
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const txSig = await program.methods
    .subscribe(SERVICE_LEVEL_ID, DURATION_WEEKS)
    .accounts({
      user: wallet.publicKey,
      pricingMatrix: pricingMatrixPda,
      tokenMint: txlMint,
      userTokenAccount,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log('    subscribed, txSig:', txSig);

  console.log('3/4 activate api token...');
  const messageString = `${txSig}:${SELECTED_LEAGUES.join(',')}:${jwt}`;
  const signature = nacl.sign.detached(new TextEncoder().encode(messageString), wallet.secretKey);
  const walletSignature = Buffer.from(signature).toString('base64');
  const apiToken = readToken(
    await postJson(
      `${DEVNET.apiOrigin}/api/token/activate`,
      { txSig, walletSignature, leagues: SELECTED_LEAGUES },
      jwt,
    ),
  );
  console.log('    api token acquired');

  console.log('4/4 writing .env...');
  const env = [
    'NODE_ENV=development',
    'PORT=3000',
    'DATABASE_URL=postgres://calledit:calledit@localhost:5432/calledit',
    'NETWORK=devnet',
    `SOLANA_RPC_URL=${DEVNET.rpc}`,
    `TXORACLE_PROGRAM_ID=${DEVNET.programId}`,
    `TXL_TOKEN_MINT=${DEVNET.txlMint}`,
    `TXLINE_API_ORIGIN=${DEVNET.apiOrigin}`,
    `TXLINE_JWT=${jwt}`,
    `TXLINE_API_TOKEN=${apiToken}`,
    `SERVICE_WALLET_SECRET=${KEYPAIR_PATH}`,
    '',
  ].join('\n');
  if (existsSync('.env')) {
    writeFileSync('.env.bootstrap', env);
    console.log('    .env exists — wrote .env.bootstrap instead (review then rename)');
  } else {
    writeFileSync('.env', env);
    console.log('    wrote .env');
  }
  console.log('\nDONE. credentials ready.');
}

main().catch((error: unknown) => {
  console.error('bootstrap failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
