import { describe, it, expect } from 'vitest';
import { streamEvents } from '../src/txline/client.js';

function sseResponse(record: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller): void {
      controller.enqueue(new TextEncoder().encode(record));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

const instantWait = async (_ms: number): Promise<void> => {};

describe('streamEvents', () => {
  it('renews the jwt after 401s (with backoff) and delivers the event once authorized', async () => {
    let fetchCalls = 0;
    let jwtCalls = 0;
    let waitCalls = 0;
    const received: unknown[] = [];
    const controller = new AbortController();

    await streamEvents({
      origin: 'https://feed.example',
      path: '/stream',
      apiToken: 'token',
      getJwt: async () => {
        jwtCalls += 1;
        return `jwt-${jwtCalls}`;
      },
      onEvent: async (raw) => {
        received.push(raw);
        controller.abort();
      },
      signal: controller.signal,
      fetchImpl: async () => {
        fetchCalls += 1;
        if (fetchCalls <= 2) return new Response(null, { status: 401 });
        return sseResponse('data: {"ok":true}\n\n');
      },
      wait: async (ms) => {
        waitCalls += 1;
        await instantWait(ms);
      },
    });

    expect(fetchCalls).toBe(3);
    expect(jwtCalls).toBe(3);
    expect(waitCalls).toBeGreaterThanOrEqual(2);
    expect(received).toEqual([{ ok: true }]);
  });

  it('throws after the consecutive-401 cap instead of looping forever', async () => {
    let fetchCalls = 0;

    await expect(
      streamEvents({
        origin: 'https://feed.example',
        path: '/stream',
        apiToken: 'token',
        getJwt: async () => 'bad-jwt',
        onEvent: async () => {},
        fetchImpl: async () => {
          fetchCalls += 1;
          return new Response(null, { status: 401 });
        },
        wait: instantWait,
      }),
    ).rejects.toThrow(/consecutive 401/);

    expect(fetchCalls).toBe(5);
  }, 2_000);
});
