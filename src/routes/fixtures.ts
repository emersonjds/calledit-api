import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { fixturesSchema } from '../schemas/index.js';
import { getUpcomingFixtures } from '../services/fixtures.js';

export async function fixturesRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/api/fixtures/upcoming',
    {
      schema: {
        tags: ['fixtures'],
        summary: 'List upcoming fixtures',
        description: 'Returns World Cup fixtures from the TxLINE snapshot feed.',
        response: { 200: fixturesSchema },
      },
    },
    async () => ({ items: await getUpcomingFixtures() }),
  );
}
