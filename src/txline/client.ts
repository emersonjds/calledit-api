import { parseSseChunk } from './sse.js';

export interface StreamEventsOptions {
  origin: string;
  path: string;
  apiToken: string;
  getJwt: () => Promise<string>;
  onEvent: (raw: unknown) => Promise<void>;
  signal?: AbortSignal;
}

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

class UnauthorizedError extends Error {}

// Wrapped in a function so TS re-reads `.aborted` fresh each call instead of
// narrowing it as constant across awaits (it flips asynchronously).
function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

// Long-lived: resolves only once `signal` aborts. Reconnects forever on
// network errors (capped backoff) and re-fetches the jwt on 401 (no backoff).
export async function streamEvents(options: StreamEventsOptions): Promise<void> {
  const { origin, path, apiToken, getJwt, onEvent, signal } = options;
  let backoffMs = INITIAL_BACKOFF_MS;
  let jwt: string | null = null;

  while (!isAborted(signal)) {
    try {
      if (jwt === null) {
        jwt = await getJwt();
      }
      await consumeStream({ url: `${origin}${path}`, jwt, apiToken, onEvent, signal });
      backoffMs = INITIAL_BACKOFF_MS;
    } catch (error) {
      if (isAborted(signal)) return;
      if (error instanceof UnauthorizedError) {
        console.warn(`txline stream ${path}: jwt expired, renewing`);
        jwt = null;
        continue;
      }
      console.warn(`txline stream ${path}: reconnecting after error`, describeError(error));
      await wait(backoffMs, signal);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    }
  }
}

interface ConsumeStreamParams {
  url: string;
  jwt: string;
  apiToken: string;
  onEvent: (raw: unknown) => Promise<void>;
  signal?: AbortSignal;
}

async function consumeStream(params: ConsumeStreamParams): Promise<void> {
  const { url, jwt, apiToken, onEvent, signal } = params;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${jwt}`, 'X-Api-Token': apiToken },
    signal,
  });

  if (response.status === 401) {
    throw new UnauthorizedError('txline jwt expired');
  }
  if (!response.ok || response.body === null) {
    throw new Error(`txline stream request failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSseChunk(buffer);
    buffer = rest;
    for (const eventText of events) {
      const raw: unknown = JSON.parse(eventText);
      await onEvent(raw);
    }
  }
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
