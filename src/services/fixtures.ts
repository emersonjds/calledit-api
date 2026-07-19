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

export async function getFixtureTeams(
  fixtureId: string,
): Promise<{ home: TeamInfo; away: TeamInfo } | null> {
  const items = await cachedFixtures();
  const fixture = items.find((item) => item.id === fixtureId);
  return fixture ? { home: fixture.home, away: fixture.away } : null;
}

export async function getFixtureKickoff(fixtureId: string): Promise<number | null> {
  const items = await cachedFixtures();
  const fixture = items.find((item) => item.id === fixtureId);
  return fixture ? fixture.kickoff : null;
}
