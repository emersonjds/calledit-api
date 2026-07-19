import { z } from 'zod';

export const teamInfoSchema = z.object({
  code: z.string(),
  name: z.string(),
  flag: z.string(),
});

export const matchEventSchema = z.object({
  id: z.string(),
  type: z.enum(['goal', 'yellow', 'red', 'corner', 'foul', 'sub', 'var']),
  side: z.enum(['home', 'away']),
  clockMin: z.number(),
  player: z.string().optional(),
  detail: z.string().optional(),
});

export const matchSnapshotSchema = z.object({
  matchId: z.string(),
  clockMin: z.number(),
  period: z.enum(['1H', 'HT', '2H', 'ET', 'PENS', 'FT']),
  home: teamInfoSchema,
  away: teamInfoSchema,
  score: z.tuple([z.number(), z.number()]),
  pct: z.object({ home: z.number(), draw: z.number(), away: z.number() }),
  events: z.array(matchEventSchema),
  markets: z.array(z.object({ market: z.string(), multiplier: z.number() })),
  live: z.boolean(),
});

export const walletAccountSchema = z.object({
  address: z.string(),
  balanceSol: z.number(),
  chain: z.enum(['solana', 'evm']),
  provider: z.string(),
});

export const stampSchema = z.object({
  txHash: z.string(),
  stampedAt: z.number(),
  seq: z.number().int().min(1).describe('Monotonic TxLINE event sequence number the call was stamped against.'),
  epochDay: z.number().int(),
});

export const settlementSchema = z.object({
  proofId: z.string(),
  payoutSol: z.number(),
  calledSecondsBefore: z.number(),
  resolvedEvent: matchEventSchema.nullable(),
  verifiedOnChain: z.boolean().optional(),
  payoutTxHash: z.string().optional(),
});

export const predictionSchema = z.object({
  id: z.string(),
  matchId: z.string(),
  market: z.enum(['corner', 'card', 'goal', 'foul']).describe('Stat the call is staked on.'),
  provable: z
    .boolean()
    .describe('Whether the market settles on-chain via TxLINE proof; foul is not provable.'),
  stakeSol: z.number(),
  multiplier: z.number(),
  potentialSol: z.number(),
  atClockMin: z.number(),
  windowMin: z.number(),
  status: z.enum(['resolving', 'won', 'lost']),
  stamp: stampSchema,
  settlement: settlementSchema.optional(),
});

export const historySchema = z.object({ items: z.array(predictionSchema) });

export const walletActivitySchema = z.object({
  id: z.string(),
  type: z.enum(['deposit', 'withdraw', 'payout', 'stake']),
  amountSol: z.number(),
  fiatAmount: z.number().optional(),
  method: z.string().optional(),
  status: z.enum(['settled', 'pending']),
  ts: z.number(),
});

export const walletOverviewSchema = z.object({
  address: z.string(),
  balanceSol: z.number(),
  currency: z.string(),
  fiatRate: z.number(),
  activity: z.array(walletActivitySchema),
});

export const fixtureSchema = z.object({
  id: z.string(),
  home: teamInfoSchema,
  away: teamInfoSchema,
  kickoff: z.number(),
  stage: z.string(),
  venue: z.string(),
});

export const fixturesSchema = z.object({ items: z.array(fixtureSchema) });

export const profileSchema = z.object({
  address: z.string(),
  handle: z.string(),
  accuracy: z.number(),
  totalCalls: z.number(),
  wonCalls: z.number(),
  bestStreak: z.number(),
  currentStreak: z.number(),
  rank: z.number(),
  balanceSol: z.number(),
});

export const leaderboardSchema = z.object({
  entries: z.array(
    z.object({
      rank: z.number(),
      handle: z.string(),
      accuracy: z.number(),
      streak: z.number(),
      calls: z.number(),
      you: z.boolean(),
    }),
  ),
});

export const marketSchema = z.enum(['corner', 'card', 'goal', 'foul']);

// Base58, 32-44 chars — a Solana pubkey shape. Guards the payout destination at the trust
// boundary: a malformed address here would otherwise only fail later, inside sendPayout's
// `new PublicKey(to)` at settlement time, stuck retrying forever.
const solanaAddressSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'invalid solana address');

export const commitPredictionSchema = z.object({
  matchId: z.string(),
  market: marketSchema,
  stakeSol: z.number().positive(),
  address: solanaAddressSchema,
  stakeTxSig: z.string().min(1),
});

export type TeamInfo = z.infer<typeof teamInfoSchema>;
export type MatchEvent = z.infer<typeof matchEventSchema>;
export type MatchSnapshot = z.infer<typeof matchSnapshotSchema>;
export type Market = z.infer<typeof marketSchema>;
export type Prediction = z.infer<typeof predictionSchema>;
export type CommitPredictionInput = z.infer<typeof commitPredictionSchema>;
export type ProfileDto = z.infer<typeof profileSchema>;
export type LeaderboardDto = z.infer<typeof leaderboardSchema>;
export type WalletAccount = z.infer<typeof walletAccountSchema>;
export type WalletOverview = z.infer<typeof walletOverviewSchema>;
export type Fixture = z.infer<typeof fixtureSchema>;
export type Settlement = z.infer<typeof settlementSchema>;
