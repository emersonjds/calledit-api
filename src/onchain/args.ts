// @coral-xyz/anchor is CommonJS: a named `import { BN }` fails to boot under
// Node's ESM loader (Railway pins node 22). Import the default and destructure.
import anchorPkg from '@coral-xyz/anchor';
const { BN } = anchorPkg;
type BN = InstanceType<typeof BN>;
import type { ScoresStatValidationV3, ProofNodeJson, StatLeafJson } from '../txline/proof.js';

export interface Predicate {
  threshold: number;
  comparison: 'GreaterThan' | 'LessThan' | 'EqualTo';
}

export function toBytes32(b64: string): number[] {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length !== 32) throw new Error(`expected 32-byte hash, got ${buf.length}`);
  return Array.from(buf);
}

export function epochDayFromTs(ts: number): number {
  return Math.floor(ts / 86_400_000);
}

const COMPARISON = {
  GreaterThan: { greaterThan: {} },
  LessThan: { lessThan: {} },
  EqualTo: { equalTo: {} },
} as const;

function proofNode(n: ProofNodeJson): { hash: number[]; isRightSibling: boolean } {
  return { hash: toBytes32(n.hash), isRightSibling: n.isRightSibling };
}

function statTerm(leaf: StatLeafJson): {
  statToProve: { key: number; value: number; period: number };
  eventStatRoot: number[];
  statProof: { hash: number[]; isRightSibling: boolean }[];
} {
  return {
    statToProve: { key: leaf.stat.key, value: leaf.stat.value, period: leaf.stat.period },
    eventStatRoot: toBytes32(leaf.eventStatRoot),
    statProof: leaf.statProof.map(proofNode),
  };
}

export type ValidateStatArgs = [
  BN,
  { fixtureId: BN; updateStats: { updateCount: number; minTimestamp: BN; maxTimestamp: BN }; eventsSubTreeRoot: number[] },
  { hash: number[]; isRightSibling: boolean }[],
  { hash: number[]; isRightSibling: boolean }[],
  { threshold: number; comparison: (typeof COMPARISON)[keyof typeof COMPARISON] },
  ReturnType<typeof statTerm>,
  ReturnType<typeof statTerm> | null,
  null,
];

export function buildValidateStatArgs(
  proof: ScoresStatValidationV3,
  predicate: Predicate,
): ValidateStatArgs {
  const s = proof.summary;
  return [
    new BN(proof.ts),
    {
      fixtureId: new BN(s.fixtureId),
      updateStats: {
        updateCount: s.updateStats.updateCount,
        minTimestamp: new BN(s.updateStats.minTimestamp),
        maxTimestamp: new BN(s.updateStats.maxTimestamp),
      },
      eventsSubTreeRoot: toBytes32(s.eventStatsSubTreeRoot),
    },
    proof.subTreeProof.map(proofNode),
    proof.mainTreeProof.map(proofNode),
    { threshold: predicate.threshold, comparison: COMPARISON[predicate.comparison] },
    statTerm(proof.statsToProve[0]),
    proof.statsToProve[1] ? statTerm(proof.statsToProve[1]) : null,
    null,
  ];
}
