import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { Db } from './db/types.js';
import { healthRoutes } from './routes/health.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
  }
}

export interface AppOptions {
  db: Db;
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate('db', opts.db);
  app.register(cors, { origin: true });
  app.register(healthRoutes);
  return app;
}
