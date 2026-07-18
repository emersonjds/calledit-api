import 'dotenv/config';
import { Pool } from 'pg';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { startIngester } from './ingester/index.js';

const env = loadEnv();
const pool = new Pool({ connectionString: env.DATABASE_URL });
const app = buildApp({ db: pool });

app
  .listen({ port: env.PORT, host: '0.0.0.0' })
  .then((address) => {
    console.log(`calledit-api listening on ${address}`);
    startIngesterIfConfigured();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

// TxLINE credentials are optional — milestone 1 must still boot without them.
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
