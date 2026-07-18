import type { Db } from '../db/types.js';
import { fetchGuestJwt } from '../txline/auth.js';
import { streamEvents } from '../txline/client.js';
import { normalizeOddsEvent, normalizeScoreEvent } from '../txline/normalize.js';
import { recordRawEvent } from './recorder.js';

export interface IngesterConfig {
  origin: string;
  apiToken: string;
  jwt?: string;
}

export interface Ingester {
  stop: () => void;
}

// Shared across both streams: seeded with `seed` once, then re-fetches a
// fresh jwt on every subsequent call (client.ts calls it again only after a
// 401, so this never over-fetches in the happy path).
function createJwtHolder(origin: string, seed: string | undefined): () => Promise<string> {
  let seedToken: string | null = seed ?? null;
  return async function getJwt(): Promise<string> {
    if (seedToken !== null) {
      const token = seedToken;
      seedToken = null;
      return token;
    }
    return fetchGuestJwt(origin);
  };
}

interface NormalizedKeys {
  fixtureId: string;
  seq: number;
  ts: number;
}

interface StreamConfig {
  db: Db;
  origin: string;
  apiToken: string;
  getJwt: () => Promise<string>;
  signal: AbortSignal;
  kind: 'score' | 'odds';
  path: string;
  normalize: (raw: unknown) => NormalizedKeys | null;
}

function startStream(config: StreamConfig): void {
  const { db, origin, apiToken, getJwt, signal, kind, path, normalize } = config;
  streamEvents({
    origin,
    path,
    apiToken,
    getJwt,
    signal,
    onEvent: async (raw) => {
      const event = normalize(raw);
      if (event === null) return;
      await recordRawEvent(db, {
        fixtureId: event.fixtureId,
        seq: event.seq,
        kind,
        ts: event.ts,
        payload: raw,
      });
    },
  }).catch((error: unknown) => {
    console.error(`${kind} stream stopped unexpectedly`, error);
  });
}

export function startIngester(db: Db, config: IngesterConfig): Ingester {
  const { origin, apiToken, jwt } = config;
  const getJwt = createJwtHolder(origin, jwt);
  const controller = new AbortController();

  startStream({
    db,
    origin,
    apiToken,
    getJwt,
    signal: controller.signal,
    kind: 'score',
    path: '/api/scores/stream',
    normalize: normalizeScoreEvent,
  });
  startStream({
    db,
    origin,
    apiToken,
    getJwt,
    signal: controller.signal,
    kind: 'odds',
    path: '/api/odds/stream',
    normalize: normalizeOddsEvent,
  });

  return {
    stop: () => {
      controller.abort();
      console.log('ingester stopped');
    },
  };
}
