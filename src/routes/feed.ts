import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { matchSnapshotSchema, type TeamInfo } from '../schemas/index.js';
import { getFeedSnapshot } from '../services/feed.js';

// ponytail: placeholder pair until fixtures metadata lands (same stub teams milestone 1 used).
const DEFAULT_TEAMS: { home: TeamInfo; away: TeamInfo } = {
  home: { code: 'BRA', name: 'Brazil', flag: '🇧🇷' },
  away: { code: 'ARG', name: 'Argentina', flag: '🇦🇷' },
};

export async function feedRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/api/feed/:matchId',
    {
      schema: { params: z.object({ matchId: z.string() }), response: { 200: matchSnapshotSchema } },
    },
    async (req) => getFeedSnapshot(app.db, req.params.matchId, DEFAULT_TEAMS),
  );
}
