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
import { healthRoutes } from './routes/health.js';
import { predictionRoutes } from './routes/predictions.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
  }
}

export interface AppOptions {
  db: Db;
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('db', opts.db);
  app.register(cors, { origin: true });

  app.register(swagger, {
    openapi: {
      info: { title: 'Called It API', version: '0.1.0' },
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
  return app;
}
