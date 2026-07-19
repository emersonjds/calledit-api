import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { matchSnapshotSchema, type TeamInfo } from '../schemas/index.js';
import { getFeedSnapshot } from '../services/feed.js';
import { getFixtureTeams } from '../services/fixtures.js';

const DEFAULT_TEAMS: { home: TeamInfo; away: TeamInfo } = {
  home: { code: 'BRA', name: 'Brazil', flag: '🇧🇷' },
  away: { code: 'ARG', name: 'Argentina', flag: '🇦🇷' },
};

export async function feedRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/api/feed/:matchId',
    {
      schema: {
        tags: ['feed'],
        summary: 'Get a live match snapshot',
        description:
          'Projects the recorded TxLINE score and odds events for a match into clock, score, win-probability and market state.',
        params: z.object({ matchId: z.string() }),
        response: { 200: matchSnapshotSchema },
      },
    },
    async (req) => {
      const teams = (await getFixtureTeams(req.params.matchId).catch(() => null)) ?? DEFAULT_TEAMS;
      return getFeedSnapshot(app.db, req.params.matchId, teams);
    },
  );
}
