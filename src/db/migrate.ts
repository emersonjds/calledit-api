import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Pool } from 'pg';
import type { Db } from './types.js';
import { loadEnv } from '../config/env.js';

const here = dirname(fileURLToPath(import.meta.url));

export async function runMigration(db: Db): Promise<void> {
  const sql = readFileSync(join(here, 'schema.sql'), 'utf8');
  await db.query(sql);
}

// Run directly: `pnpm migrate`
if (import.meta.url === `file://${process.argv[1]}`) {
  const env = loadEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  runMigration(pool)
    .then(() => {
      console.log('migration applied');
      return pool.end();
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
