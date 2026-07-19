export interface ScoreCumulative {
  goalsHome: number;
  goalsAway: number;
  yellowHome: number;
  yellowAway: number;
  redHome: number;
  redAway: number;
  cornersHome: number;
  cornersAway: number;
}

export interface NormalizedScoreEvent {
  fixtureId: string;
  seq: number;
  ts: number;
  gameState: string;
  action?: string;
  clockSeconds?: number;
  clockRunning?: boolean;
  statusId?: number;
  cumulative: ScoreCumulative;
}

export interface NormalizedOddsEvent {
  fixtureId: string;
  seq: number;
  ts: number;
  pct: { home: number; draw: number; away: number };
  markets: { market: string; multiplier: number }[];
  inRunning: boolean;
  gameState: string;
}
