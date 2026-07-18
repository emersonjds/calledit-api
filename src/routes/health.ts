import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
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
