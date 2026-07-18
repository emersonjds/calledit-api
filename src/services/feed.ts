import type { Db } from '../db/types.js';
import type { MatchSnapshot, TeamInfo } from '../schemas/index.js';
import { normalizeOddsEvent, normalizeScoreEvent } from '../txline/normalize.js';
import type { NormalizedOddsEvent, NormalizedScoreEvent } from '../txline/types.js';
import { projectSnapshot } from './projector.js';

interface FeedEventRow {
  kind: 'score' | 'odds';
  seq: number;
  payload: unknown;
}

function isDefined<T>(value: T | null): value is T {
  return value !== null;
}

export async function getFeedSnapshot(
  db: Db,
  matchId: string,
  teams: { home: TeamInfo; away: TeamInfo },
): Promise<MatchSnapshot> {
  const { rows } = await db.query<FeedEventRow>(
    'select kind, seq, payload from feed_events where fixture_id = $1 order by seq asc',
    [matchId],
  );

  const scoreEvents: NormalizedScoreEvent[] = rows
    .filter((row) => row.kind === 'score')
    .map((row) => normalizeScoreEvent(row.payload))
    .filter(isDefined);

  const oddsEvents: NormalizedOddsEvent[] = rows
    .filter((row) => row.kind === 'odds')
    .map((row) => normalizeOddsEvent(row.payload))
    .filter(isDefined);

  return projectSnapshot(matchId, scoreEvents, oddsEvents, teams);
}
