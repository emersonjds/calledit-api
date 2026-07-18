import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  leaderboardSchema,
  profileSchema,
  walletAccountSchema,
  walletOverviewSchema,
} from '../schemas/index.js';
import type { WalletAccount, WalletOverview } from '../schemas/index.js';

export async function stubRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/api/wallet/connect',
    {
      schema: {
        tags: ['wallet'],
        summary: 'Connect a wallet',
        description: 'Registers a wallet provider (e.g. Phantom) for the session. Stubbed pending real signing.',
        body: z.object({ provider: z.string() }),
        response: { 200: walletAccountSchema },
      },
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
      schema: {
        tags: ['profile'],
        summary: 'Get caller profile',
        description: 'Returns accuracy, streak, and balance stats for a wallet address. Stubbed.',
        querystring: z.object({ address: z.string() }),
        response: { 200: profileSchema },
      },
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
        tags: ['leaderboard'],
        summary: 'Get the leaderboard',
        description: 'Returns callers ranked by accuracy and streak, with the requesting address highlighted. Stubbed.',
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
        tags: ['wallet'],
        summary: 'Get wallet overview',
        description: 'Returns SOL balance, fiat rate, and recent activity for a wallet address. Stubbed.',
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
        tags: ['wallet'],
        summary: 'Deposit SOL',
        description: 'Credits a wallet with SOL and returns the updated overview. Stubbed.',
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
        tags: ['wallet'],
        summary: 'Withdraw SOL',
        description: 'Debits a wallet with SOL via the given method and returns the updated overview. Stubbed.',
        body: z.object({ address: z.string(), amountSol: z.number(), method: z.string() }),
        response: { 200: walletOverviewSchema },
      },
    },
    async (req) => overview(req.body.address),
  );
}
