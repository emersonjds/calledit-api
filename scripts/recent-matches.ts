import 'dotenv/config';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing env ${name}`);
  }
  return value;
}

async function authGet(path: string): Promise<unknown> {
  const response = await fetch(`${requireEnv('TXLINE_API_ORIGIN')}${path}`, {
    headers: {
      Authorization: `Bearer ${requireEnv('TXLINE_JWT')}`,
      'X-Api-Token': requireEnv('TXLINE_API_TOKEN'),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${path} → ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

interface Fixture {
  FixtureId: number;
  Participant1: string;
  Participant2: string;
  Competition: string;
  StartTime: number;
  GameState: number;
}

function isFixtureArray(value: unknown): value is Fixture[] {
  return Array.isArray(value);
}

async function main(): Promise<void> {
  const fixtures = await authGet('/api/fixtures/snapshot');
  if (!isFixtureArray(fixtures)) {
    console.log('unexpected shape:', JSON.stringify(fixtures).slice(0, 300));
    return;
  }
  console.log('total fixtures:', fixtures.length);
  const byState: Record<number, number> = {};
  for (const fixture of fixtures) {
    byState[fixture.GameState] = (byState[fixture.GameState] ?? 0) + 1;
  }
  console.log('GameStates:', JSON.stringify(byState));
  const sorted = [...fixtures].sort((a, b) => a.StartTime - b.StartTime);
  for (const fixture of sorted) {
    const when = new Date(fixture.StartTime).toISOString().slice(0, 16);
    console.log(
      `${when}  GS${fixture.GameState}  ${fixture.Participant1} v ${fixture.Participant2}  | ${fixture.Competition}  fix${fixture.FixtureId}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
