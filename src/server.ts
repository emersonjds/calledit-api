import 'dotenv/config';
import { Pool } from 'pg';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { runMigration } from './db/migrate.js';
import { startIngester } from './ingester/index.js';
import { startSettlementWorker } from './settlement/worker.js';

const env = loadEnv();
const pool = new Pool({ connectionString: env.DATABASE_URL });
const publicUrl =
  env.PUBLIC_URL ??
  (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : undefined);
const app = buildApp({ db: pool, corsOrigins: env.CORS_ORIGINS, publicUrl });

// Open the port first so the platform healthcheck (/health) goes green immediately,
// then migrate + start workers. A DB hiccup must not keep the port closed and trip
// the healthcheck — it's logged loudly instead. ponytail: single process, no `migrate && server`.
app
  .listen({ port: env.PORT, host: '0.0.0.0' })
  .then(async (address) => {
    console.log(`calledit-api listening on ${address}`);
    try {
      await runMigration(pool);
      console.log('migration applied');
    } catch (error) {
      console.error('migration failed (server stays up so /health works):', error);
    }
    startIngesterIfConfigured();
    startSettlementWorker(pool);
    console.log('settlement worker started');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

function startIngesterIfConfigured(): void {
  if (env.TXLINE_API_ORIGIN === undefined || env.TXLINE_API_TOKEN === undefined) {
    console.log('ingester disabled (no TxLINE credentials)');
    return;
  }
  startIngester(pool, {
    origin: env.TXLINE_API_ORIGIN,
    apiToken: env.TXLINE_API_TOKEN,
    jwt: env.TXLINE_JWT,
  });
  console.log('ingester started');
}
