import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getUpcomingFixtures } from '../src/services/fixtures.js';

const rawFixture = {
  FixtureId: 101,
  Participant1: 'France',
  Participant2: 'England',
  Participant1Id: 1,
  Participant2Id: 2,
  Competition: 'Group A',
  StartTime: 1_752_000_000_000,
  GameState: 0,
  Participant1IsHome: true,
};

// live TxLINE omits GameState on some unscheduled fixtures — must still parse.
const rawFixtureWithoutGameState = {
  FixtureId: 102,
  Participant1: 'Brazil',
  Participant2: 'Australia',
  Competition: 'Friendlies',
  StartTime: 1_760_000_000_000,
  Participant1IsHome: false,
};

describe('getUpcomingFixtures', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.TXLINE_API_ORIGIN = 'https://feed.example';
    process.env.TXLINE_JWT = 'jwt';
    process.env.TXLINE_API_TOKEN = 'token';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it('maps raw TxLINE fixtures to the frontend shape, honoring Participant1IsHome', async () => {
    const mockFetch: typeof fetch = async (url, init) => {
      expect(String(url)).toBe('https://feed.example/api/fixtures/snapshot');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer jwt');
      expect(headers.get('X-Api-Token')).toBe('token');
      return new Response(
        JSON.stringify([rawFixture, rawFixtureWithoutGameState]),
        { status: 200 },
      );
    };
    globalThis.fetch = mockFetch;

    const fixtures = await getUpcomingFixtures();

    expect(fixtures).toEqual([
      {
        id: '101',
        home: { code: 'FRA', name: 'France', flag: '' },
        away: { code: 'ENG', name: 'England', flag: '' },
        kickoff: 1_752_000_000_000,
        stage: 'Group A',
        venue: '',
      },
      {
        id: '102',
        home: { code: 'AUS', name: 'Australia', flag: '' },
        away: { code: 'BRA', name: 'Brazil', flag: '' },
        kickoff: 1_760_000_000_000,
        stage: 'Friendlies',
        venue: '',
      },
    ]);
  });

  it('throws a clear error when TxLINE credentials are missing', async () => {
    delete process.env.TXLINE_API_ORIGIN;
    await expect(getUpcomingFixtures()).rejects.toThrow(/missing env TXLINE_API_ORIGIN/);
  });
});
