import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  // Optional in milestone 1 — used by the feed ingester and settlement later.
  NETWORK: z.enum(['mainnet', 'devnet']).optional(),
  SOLANA_RPC_URL: z.string().optional(),
  TXORACLE_PROGRAM_ID: z.string().optional(),
  TXL_TOKEN_MINT: z.string().optional(),
  TXLINE_API_ORIGIN: z.string().optional(),
  TXLINE_JWT: z.string().optional(),
  TXLINE_API_TOKEN: z.string().optional(),
  SERVICE_WALLET_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  return parsed.data;
}
