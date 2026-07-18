import { Pool } from 'pg';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const pool = new Pool({ connectionString: env.DATABASE_URL });
const app = buildApp({ db: pool });

app
  .listen({ port: env.PORT, host: '0.0.0.0' })
  .then((address) => console.log(`calledit-api listening on ${address}`))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
