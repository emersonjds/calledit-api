import { parseSseChunk } from './sse.js';

export interface StreamEventsOptions {
  origin: string;
  path: string;
  apiToken: string;
  getJwt: () => Promise<string>;
  onEvent: (raw: unknown) => Promise<void>;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
}

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const MAX_CONSECUTIVE_UNAUTHORIZED = 5;

class UnauthorizedError extends Error {}

// Wrapped in a function so TS re-reads `.aborted` fresh each call instead of
// narrowing it as constant across awaits (it flips asynchronously).
function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

// Long-lived: resolves only once `signal` aborts. Reconnects forever on
// network errors (capped backoff) and re-fetches the jwt on 401 (same capped
// backoff, plus a hard cap on consecutive 401s so bad credentials fail loud
// instead of hammering the guest-auth endpoint forever).
export async function streamEvents(options: StreamEventsOptions): Promise<void> {
  const {
    origin,
    path,
    apiToken,
    getJwt,
    onEvent,
    signal,
    fetchImpl = globalThis.fetch,
    wait: waitImpl = (ms: number) => wait(ms, signal),
  } = options;
  let backoffMs = INITIAL_BACKOFF_MS;
  let jwt: string | null = null;
  let consecutiveUnauthorized = 0;

  while (!isAborted(signal)) {
    try {
      if (jwt === null) {
        jwt = await getJwt();
      }
      await consumeStream({
        url: `${origin}${path}`,
        jwt,
        apiToken,
        onEvent,
        signal,
        fetchImpl,
        onConnected: () => {
          consecutiveUnauthorized = 0;
        },
      });
      backoffMs = INITIAL_BACKOFF_MS;
    } catch (error) {
      if (isAborted(signal)) return;
      if (error instanceof UnauthorizedError) {
        consecutiveUnauthorized += 1;
        if (consecutiveUnauthorized >= MAX_CONSECUTIVE_UNAUTHORIZED) {
          throw new Error(
            `txline stream ${path}: ${consecutiveUnauthorized} consecutive 401s, credentials are likely invalid`,
            { cause: error },
          );
        }
        console.warn(`txline stream ${path}: jwt expired, renewing (attempt ${consecutiveUnauthorized})`);
        jwt = null;
        await waitImpl(backoffMs);
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        continue;
      }
      console.warn(`txline stream ${path}: reconnecting after error`, describeError(error));
      await waitImpl(backoffMs);
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
  fetchImpl: typeof fetch;
  onConnected: () => void;
}

async function consumeStream(params: ConsumeStreamParams): Promise<void> {
  const { url, jwt, apiToken, onEvent, signal, fetchImpl, onConnected } = params;
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${jwt}`, 'X-Api-Token': apiToken },
    signal,
  });

  if (response.status === 401) {
    throw new UnauthorizedError('txline jwt expired');
  }
  if (!response.ok || response.body === null) {
    throw new Error(`txline stream request failed: ${response.status}`);
  }
  onConnected();

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
    const timer = setTimeout(onDone, ms);
    signal?.addEventListener('abort', onDone, { once: true });

    function onDone(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onDone);
      resolve();
    }
  });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
