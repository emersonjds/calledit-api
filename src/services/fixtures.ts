import type { Fixture, TeamInfo } from '../schemas/index.js';
import { txlineGet } from '../txline/api.js';

interface RawFixture {
  FixtureId: number;
  Participant1: string;
  Participant2: string;
  Competition: string;
  StartTime: number;
  Participant1IsHome: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// GameState is absent on some live fixtures (unstarted, not yet scheduled by
// the feed) and unused in the mapped Fixture — don't require it here.
function isRawFixture(value: unknown): value is RawFixture {
  if (!isRecord(value)) return false;
  return (
    typeof value.FixtureId === 'number' &&
    typeof value.Participant1 === 'string' &&
    typeof value.Participant2 === 'string' &&
    typeof value.Competition === 'string' &&
    typeof value.StartTime === 'number' &&
    typeof value.Participant1IsHome === 'boolean'
  );
}

function isRawFixtureArray(value: unknown): value is RawFixture[] {
  return Array.isArray(value) && value.every(isRawFixture);
}

function toTeamInfo(name: string): TeamInfo {
  return { code: name.slice(0, 3).toUpperCase(), name, flag: '' };
}

function toFixture(raw: RawFixture): Fixture {
  const [homeName, awayName] = raw.Participant1IsHome
    ? [raw.Participant1, raw.Participant2]
    : [raw.Participant2, raw.Participant1];
  return {
    id: String(raw.FixtureId),
    home: toTeamInfo(homeName),
    away: toTeamInfo(awayName),
    kickoff: raw.StartTime,
    stage: raw.Competition,
    venue: '',
  };
}

export async function getUpcomingFixtures(): Promise<Fixture[]> {
  const raw = await txlineGet('/api/fixtures/snapshot');
  if (!isRawFixtureArray(raw)) {
    throw new Error('txline fixtures snapshot: unexpected response shape');
  }
  return raw.map(toFixture);
}

// ponytail: module-level cache, one process — the feed route would otherwise
// re-fetch the whole TxLINE fixtures snapshot on every poll. Upgrade to a
// shared cache (Redis) only if this runs across multiple instances.
let fixturesCache: { items: Fixture[]; fetchedAt: number } | null = null;
const FIXTURES_CACHE_TTL_MS = 60_000;

async function cachedFixtures(): Promise<Fixture[]> {
  if (fixturesCache && Date.now() - fixturesCache.fetchedAt < FIXTURES_CACHE_TTL_MS) {
    return fixturesCache.items;
  }
  const items = await getUpcomingFixtures();
  fixturesCache = { items, fetchedAt: Date.now() };
  return items;
}

/**
 * Home/away team metadata for a TxLINE fixture id, from the same cached
 * snapshot `/api/fixtures/upcoming` uses. Null if the fixture isn't found or
 * TxLINE is unreachable — callers should fall back to a placeholder, never throw.
 */
export async function getFixtureTeams(
  fixtureId: string,
): Promise<{ home: TeamInfo; away: TeamInfo } | null> {
  const items = await cachedFixtures();
  const fixture = items.find((item) => item.id === fixtureId);
  return fixture ? { home: fixture.home, away: fixture.away } : null;
}

/**
 * Kickoff (epoch ms) for a fixture, from the same cached snapshot. The raw feed
 * carries no match-clock minute, so kickoff + wall-clock is the only source of a
 * real match minute. Null if unknown/unreachable — callers must fall back, never throw.
 */
export async function getFixtureKickoff(fixtureId: string): Promise<number | null> {
  const items = await cachedFixtures();
  const fixture = items.find((item) => item.id === fixtureId);
  return fixture ? fixture.kickoff : null;
}
