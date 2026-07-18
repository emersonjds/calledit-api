import { writeFileSync } from 'node:fs';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';

const DEVNET_RPC = 'https://api.devnet.solana.com';
const TXORACLE_DEVNET = '6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J';

async function main(): Promise<void> {
  const connection = new Connection(DEVNET_RPC, 'confirmed');
  const provider = new AnchorProvider(connection, new Wallet(Keypair.generate()), {
    commitment: 'confirmed',
  });
  const programId = new PublicKey(TXORACLE_DEVNET);
  const idl = await Program.fetchIdl(programId, provider);
  if (!idl) {
    console.error(`No on-chain IDL published for ${programId.toBase58()}`);
    process.exit(1);
  }
  writeFileSync('idl/txoracle.json', `${JSON.stringify(idl, null, 2)}\n`);
  const instructions = idl.instructions.map((instruction) => instruction.name);
  console.log(`IDL fetched: ${instructions.length} instructions`);
  console.log(`instructions: ${instructions.join(', ')}`);
  const validate = idl.instructions.filter((instruction) => instruction.name.includes('validate'));
  console.log(`validate_* instructions: ${validate.map((i) => i.name).join(', ') || '(none)'}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
