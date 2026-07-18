import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  fixturesSchema,
  leaderboardSchema,
  matchSnapshotSchema,
  profileSchema,
  walletAccountSchema,
  walletOverviewSchema,
} from '../schemas/index.js';

const BRA = { code: 'BRA', name: 'Brazil', flag: '🇧🇷' };
const ARG = { code: 'ARG', name: 'Argentina', flag: '🇦🇷' };

export async function stubRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/api/wallet/connect',
    { schema: { body: z.object({ provider: z.string() }), response: { 200: walletAccountSchema } } },
    async (req) => ({ address: 'STUBwa11et', balanceSol: 12.5, chain: 'solana' as const, provider: req.body.provider }),
  );

  r.get(
    '/api/feed/:matchId',
    { schema: { params: z.object({ matchId: z.string() }), response: { 200: matchSnapshotSchema } } },
    async (req) => ({
      matchId: req.params.matchId,
      clockMin: 12,
      period: '1H' as const,
      home: BRA,
      away: ARG,
      score: [1, 0] as [number, number],
      pct: { home: 0.55, draw: 0.25, away: 0.2 },
      events: [],
      markets: [
        { market: 'goal', multiplier: 2.0 },
        { market: 'corner', multiplier: 1.6 },
        { market: 'card', multiplier: 1.8 },
      ],
      live: true,
    }),
  );

  r.get(
    '/api/me',
    { schema: { querystring: z.object({ address: z.string() }), response: { 200: profileSchema } } },
    async (req) => ({
      address: req.query.address,
      handle: 'stubcaller',
      accuracy: 0.62,
      totalCalls: 21,
      wonCalls: 13,
      bestStreak: 4,
      currentStreak: 2,
      rank: 7,
      balanceSol: 12.5,
    }),
  );

  r.get(
    '/api/leaderboard',
    { schema: { querystring: z.object({ address: z.string() }), response: { 200: leaderboardSchema } } },
    async () => ({
      entries: [
        { rank: 1, handle: 'goalgod', accuracy: 0.81, streak: 6, calls: 40, you: false },
        { rank: 7, handle: 'stubcaller', accuracy: 0.62, streak: 2, calls: 21, you: true },
      ],
    }),
  );

  r.get(
    '/api/fixtures/upcoming',
    { schema: { response: { 200: fixturesSchema } } },
    async () => ({
      items: [
        { id: 'm1', home: BRA, away: ARG, kickoff: 1_752_000_000_000, stage: 'Group A', venue: 'MetLife' },
      ],
    }),
  );

  const overview = (address: string) => ({
    address,
    balanceSol: 12.5,
    currency: 'SOL',
    fiatRate: 180,
    activity: [
      { id: 'a1', type: 'deposit' as const, amountSol: 5, status: 'settled' as const, ts: 1_751_000_000_000 },
    ],
  });

  r.get(
    '/api/wallet',
    { schema: { querystring: z.object({ address: z.string() }), response: { 200: walletOverviewSchema } } },
    async (req) => overview(req.query.address),
  );

  r.post(
    '/api/wallet/deposit',
    { schema: { body: z.object({ address: z.string(), amountSol: z.number() }), response: { 200: walletOverviewSchema } } },
    async (req) => overview(req.body.address),
  );

  r.post(
    '/api/wallet/withdraw',
    { schema: { body: z.object({ address: z.string(), amountSol: z.number(), method: z.string() }), response: { 200: walletOverviewSchema } } },
    async (req) => overview(req.body.address),
  );
}
