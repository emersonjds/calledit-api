import 'dotenv/config';
import { getUpcomingFixtures } from '../src/services/fixtures.js';

async function main(): Promise<void> {
  const fixtures = await getUpcomingFixtures();
  console.log('count:', fixtures.length);
  console.log('first:', JSON.stringify(fixtures[0], null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
