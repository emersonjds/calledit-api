import { matchSnapshotSchema, type MatchEvent, type MatchSnapshot, type TeamInfo } from '../schemas/index.js';
import type { NormalizedOddsEvent, NormalizedScoreEvent, ScoreCumulative } from '../txline/types.js';

// verify against live sample: mapping from TxLINE's raw `gameState` strings to our period
// enum is a best guess until we see real values; unknown states default to '1H'.
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

function makeEvent(fixtureId: string, seq: number, type: MatchEvent['type'], side: 'home' | 'away', n: number): MatchEvent {
  const suffix = n > 0 ? `-${n}` : '';
  // ponytail: clockMin hardcoded to 0, the feed carries no clock yet
  return { id: `${fixtureId}-${seq}-${type}-${side}${suffix}`, type, side, clockMin: 0 };
}

function diffScoreEvents(sortedScores: NormalizedScoreEvent[]): MatchEvent[] {
  const events: MatchEvent[] = [];
  for (let i = 1; i < sortedScores.length; i++) {
    const prev = sortedScores[i - 1].cumulative;
    const curr = sortedScores[i];
    for (const { type, home, away } of DIFFS) {
      for (let n = 0; n < curr.cumulative[home] - prev[home]; n++) {
        events.push(makeEvent(curr.fixtureId, curr.seq, type, 'home', n));
      }
      for (let n = 0; n < curr.cumulative[away] - prev[away]; n++) {
        events.push(makeEvent(curr.fixtureId, curr.seq, type, 'away', n));
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
    // ponytail: clockMin hardcoded to 0, the feed carries no clock yet
    clockMin: 0,
    period: mapPeriod(latestScore?.gameState ?? latestOdds?.gameState ?? ''),
    home: teams.home,
    away: teams.away,
    score: latestScore ? [latestScore.cumulative.goalsHome, latestScore.cumulative.goalsAway] : [0, 0],
    pct: latestOdds?.pct ?? { home: 0, draw: 0, away: 0 },
    events: diffScoreEvents(sortedScores),
    markets: latestOdds?.markets ?? [],
    live: latestOdds?.inRunning ?? false,
  };

  return matchSnapshotSchema.parse(snapshot);
}
