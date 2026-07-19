import { matchSnapshotSchema, type Market, type MatchEvent, type MatchSnapshot, type TeamInfo } from '../schemas/index.js';
import type { NormalizedOddsEvent, NormalizedScoreEvent, ScoreCumulative } from '../txline/types.js';
import { multiplierFor } from './markets.js';

const DEFAULT_MARKETS: Market[] = ['goal', 'card', 'corner'];

function defaultMarkets(): { market: string; multiplier: number }[] {
  return DEFAULT_MARKETS.map((market) => ({ market, multiplier: multiplierFor(market) }));
}

const PERIOD_MAP: Record<string, MatchSnapshot['period']> = {
  '1H': '1H',
  HT: 'HT',
  '2H': '2H',
  ET: 'ET',
  PENS: 'PENS',
  FT: 'FT',
};

function mapPeriod(gameState: string): MatchSnapshot['period'] {
  return PERIOD_MAP[gameState] ?? '1H';
}

const DIFFS: { type: MatchEvent['type']; home: keyof ScoreCumulative; away: keyof ScoreCumulative }[] = [
  { type: 'goal', home: 'goalsHome', away: 'goalsAway' },
  { type: 'yellow', home: 'yellowHome', away: 'yellowAway' },
  { type: 'red', home: 'redHome', away: 'redAway' },
  { type: 'corner', home: 'cornersHome', away: 'cornersAway' },
];

function makeEvent(
  fixtureId: string,
  seq: number,
  type: MatchEvent['type'],
  side: 'home' | 'away',
  n: number,
  clockMin: number,
): MatchEvent {
  const suffix = n > 0 ? `-${n}` : '';
  return { id: `${fixtureId}-${seq}-${type}-${side}${suffix}`, type, side, clockMin };
}

function diffScoreEvents(sortedScores: NormalizedScoreEvent[]): MatchEvent[] {
  const events: MatchEvent[] = [];
  for (let i = 1; i < sortedScores.length; i++) {
    const prev = sortedScores[i - 1].cumulative;
    const curr = sortedScores[i];
    const clockMin = curr.clockSeconds !== undefined ? Math.floor(curr.clockSeconds / 60) : 0;
    for (const { type, home, away } of DIFFS) {
      for (let n = 0; n < curr.cumulative[home] - prev[home]; n++) {
        events.push(makeEvent(curr.fixtureId, curr.seq, type, 'home', n, clockMin));
      }
      for (let n = 0; n < curr.cumulative[away] - prev[away]; n++) {
        events.push(makeEvent(curr.fixtureId, curr.seq, type, 'away', n, clockMin));
      }
    }
  }
  return events;
}

export function projectSnapshot(
  matchId: string,
  scoreEvents: NormalizedScoreEvent[],
  oddsEvents: NormalizedOddsEvent[],
  teams: { home: TeamInfo; away: TeamInfo },
): MatchSnapshot {
  const sortedScores = [...scoreEvents].sort((a, b) => a.seq - b.seq);
  const latestScore = sortedScores.at(-1);
  const latestOdds = [...oddsEvents].sort((a, b) => a.seq - b.seq).at(-1);

  const snapshot: MatchSnapshot = {
    matchId,
    clockMin: latestScore?.clockSeconds !== undefined ? Math.floor(latestScore.clockSeconds / 60) : 0,
    period: mapPeriod(latestScore?.gameState ?? latestOdds?.gameState ?? ''),
    home: teams.home,
    away: teams.away,
    score: latestScore ? [latestScore.cumulative.goalsHome, latestScore.cumulative.goalsAway] : [0, 0],
    pct: latestOdds?.pct ?? { home: 0, draw: 0, away: 0 },
    events: diffScoreEvents(sortedScores),
    markets: latestOdds?.markets.length ? latestOdds.markets : defaultMarkets(),
    live: latestScore?.clockRunning === true || latestScore?.statusId === 2,
  };

  return matchSnapshotSchema.parse(snapshot);
}
