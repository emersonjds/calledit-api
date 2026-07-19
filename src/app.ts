import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Db } from './db/types.js';
import { feedRoutes } from './routes/feed.js';
import { fixturesRoutes } from './routes/fixtures.js';
import { healthRoutes } from './routes/health.js';
import { predictionRoutes } from './routes/predictions.js';
import { stubRoutes } from './routes/stubs.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
  }
}

export interface AppOptions {
  db: Db;
  corsOrigins?: string[];
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('db', opts.db);
  // Allow-list the front's domains via CORS_ORIGINS; unset = open to any origin.
  app.register(cors, {
    origin: opts.corsOrigins?.length ? opts.corsOrigins : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.register(swagger, {
    openapi: {
      info: {
        title: 'Called It API',
        version: '0.1.0',
        description:
          'Backend for Called It — TxLINE feed ingestion, on-chain-stamped predictions, and settlement.',
      },
      servers: [{ url: 'http://localhost:3000', description: 'local' }],
      tags: [
        { name: 'health', description: 'Service liveness.' },
        { name: 'predictions', description: 'Commit, list, and fetch calls.' },
        { name: 'feed', description: 'Live match snapshots derived from the TxLINE feed.' },
        { name: 'fixtures', description: 'Upcoming World Cup fixtures from TxLINE.' },
        { name: 'wallet', description: 'Wallet connect, balance, deposit, and withdraw.' },
        { name: 'profile', description: 'Caller stats and accuracy.' },
        { name: 'leaderboard', description: 'Ranked callers by accuracy and streak.' },
      ],
    },
    transform: jsonSchemaTransform,
  });
  app.register(swaggerUi, {
    routePrefix: '/docs',
    theme: {
      // Hide the Swagger/Fastify topbar logo — clean docs header.
      css: [{ filename: 'theme.css', content: '.swagger-ui .topbar { display: none }' }],
    },
  });

  app.register(healthRoutes);
  app.register(predictionRoutes);
  app.register(feedRoutes);
  app.register(fixturesRoutes);
  app.register(stubRoutes);
  return app;
}
