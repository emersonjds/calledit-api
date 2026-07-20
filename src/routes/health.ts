import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/',
    {
      schema: {
        tags: ['health'],
        summary: 'API index',
        description: 'Welcome payload with links to the docs and health check.',
      },
    },
    async () => ({
      name: 'Called It API',
      description: 'Live, on-chain-verified World Cup 2026 predictions on Solana',
      docs: '/swagger',
      health: '/health',
      frontend: 'https://called-it.netlify.app',
    }),
  );

  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Liveness check',
        description: 'Returns ok when the API process is up. Does not check the database or TxLINE.',
      },
    },
    async () => ({ status: 'ok' }),
  );
}
