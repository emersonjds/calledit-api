import { txlineGet } from './api.js';

export interface ScoreStatJson { key: number; value: number; period: number }
export interface ProofNodeJson { hash: string; isRightSibling: boolean }
export interface StatLeafJson { stat: ScoreStatJson; statProof: ProofNodeJson[]; eventStatRoot: string }
export interface ScoresBatchSummaryJson {
  fixtureId: number;
  updateStats: { updateCount: number; minTimestamp: number; maxTimestamp: number };
  eventStatsSubTreeRoot: string;
}
export interface ScoresStatValidationV3 {
  ts: number;
  summary: ScoresBatchSummaryJson;
  eventStatRoot: string;
  statsToProve: StatLeafJson[];
  subTreeProof: ProofNodeJson[];
  mainTreeProof: ProofNodeJson[];
}

export function statProofPath(fixtureId: number, seq: number, statKeys: string): string {
  const q = new URLSearchParams({ fixtureId: String(fixtureId), seq: String(seq), statKeys });
  return `/api/scores/stat-validation-v3?${q.toString()}`;
}

export async function fetchStatProof(
  fixtureId: number,
  seq: number,
  statKeys: string,
): Promise<ScoresStatValidationV3> {
  return (await txlineGet(statProofPath(fixtureId, seq, statKeys))) as ScoresStatValidationV3;
}
