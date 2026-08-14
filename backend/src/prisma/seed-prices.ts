/**
 * Price-history-only seed.
 *
 * The full `db:seed` also creates the demo farmer and farm. This entry point
 * rebuilds just the mandi price series, so an existing database with real users
 * and farms can get its charts working again without touching anything else.
 *
 * Run with: npm run db:seed:prices
 */

import { prisma } from '../common/prisma';
import { seedPriceHistory } from '../modules/market/market.service';

async function main(): Promise<void> {
  console.log('\nSeeding mandi price history…\n');
  const rows = await seedPriceHistory(90);
  console.log(`  Price history: ${rows} rows`);

  const mandis = await prisma.priceHistory.groupBy({ by: ['marketName'], _count: { _all: true } });
  const states = await prisma.priceHistory.groupBy({ by: ['state'] });
  console.log(`  Mandis: ${mandis.length}   States: ${states.length}\n`);
}

main()
  .catch((err) => {
    console.error('\nPrice seed failed:', err instanceof Error ? err.message : err, '\n');
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
