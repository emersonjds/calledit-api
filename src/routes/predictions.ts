import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { commitPredictionSchema, historySchema, predictionSchema } from '../schemas/index.js';
import { createPrediction, getPredictionById, listByAddress } from '../services/predictions.js';

export async function predictionRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/api/predictions',
    { schema: { body: commitPredictionSchema, response: { 200: predictionSchema } } },
    async (req) => createPrediction(app.db, req.body),
  );

  r.get(
    '/api/predictions',
    {
      schema: { querystring: z.object({ address: z.string() }), response: { 200: historySchema } },
    },
    async (req) => ({ items: await listByAddress(app.db, req.query.address) }),
  );

  r.get(
    '/api/predictions/:id',
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: {
          200: predictionSchema,
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const found = await getPredictionById(app.db, req.params.id);
      if (!found) return reply.code(404).send({ error: 'not_found' });
      return found;
    },
  );
}
