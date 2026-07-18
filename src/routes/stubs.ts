import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  fixturesSchema,
  leaderboardSchema,
  profileSchema,
  walletAccountSchema,
  walletOverviewSchema,
} from '../schemas/index.js';
import type { WalletAccount, WalletOverview } from '../schemas/index.js';

const BRA = { code: 'BRA', name: 'Brazil', flag: '🇧🇷' };
const ARG = { code: 'ARG', name: 'Argentina', flag: '🇦🇷' };

export async function stubRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/api/wallet/connect',
    {
      schema: { body: z.object({ provider: z.string() }), response: { 200: walletAccountSchema } },
    },
    async (req): Promise<WalletAccount> => ({
      address: 'stub-wallet-address',
      balanceSol: 12.5,
      chain: 'solana',
      provider: req.body.provider,
    }),
  );

  r.get(
    '/api/me',
    {
      schema: { querystring: z.object({ address: z.string() }), response: { 200: profileSchema } },
    },
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
    {
      schema: {
        querystring: z.object({ address: z.string() }),
        response: { 200: leaderboardSchema },
      },
    },
    async () => ({
      entries: [
        { rank: 1, handle: 'goalgod', accuracy: 0.81, streak: 6, calls: 40, you: false },
        { rank: 7, handle: 'stubcaller', accuracy: 0.62, streak: 2, calls: 21, you: true },
      ],
    }),
  );

  r.get('/api/fixtures/upcoming', { schema: { response: { 200: fixturesSchema } } }, async () => ({
    items: [
      {
        id: 'm1',
        home: BRA,
        away: ARG,
        kickoff: 1_752_000_000_000,
        stage: 'Group A',
        venue: 'MetLife',
      },
    ],
  }));

  const overview = (address: string): WalletOverview => ({
    address,
    balanceSol: 12.5,
    currency: 'SOL',
    fiatRate: 180,
    activity: [
      {
        id: 'a1',
        type: 'deposit',
        amountSol: 5,
        status: 'settled',
        ts: 1_751_000_000_000,
      },
    ],
  });

  r.get(
    '/api/wallet',
    {
      schema: {
        querystring: z.object({ address: z.string() }),
        response: { 200: walletOverviewSchema },
      },
    },
    async (req) => overview(req.query.address),
  );

  r.post(
    '/api/wallet/deposit',
    {
      schema: {
        body: z.object({ address: z.string(), amountSol: z.number() }),
        response: { 200: walletOverviewSchema },
      },
    },
    async (req) => overview(req.body.address),
  );

  r.post(
    '/api/wallet/withdraw',
    {
      schema: {
        body: z.object({ address: z.string(), amountSol: z.number(), method: z.string() }),
        response: { 200: walletOverviewSchema },
      },
    },
    async (req) => overview(req.body.address),
  );
}
