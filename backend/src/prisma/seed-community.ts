/**
 * Community outbreak seed.
 *
 * The nearby-outbreak feature aggregates severe crop health reports from farms
 * within ~50 km. With a single farm in the database it has nothing to show, so
 * this creates a realistic neighbourhood around the demo farm.
 *
 * The data models a genuine agronomic situation rather than random noise: a
 * rice blast outbreak clustered in the humid Lucknow belt during kharif, which
 * is exactly when and where blast spreads. Farms are placed at real distances
 * so the radius filter is genuinely exercised.
 *
 * Run with: npm run db:seed:community
 */

import bcrypt from 'bcryptjs';
import { prisma } from '../common/prisma';
import { logger } from '../common/logger';
import { upsertWithoutTransaction } from '../common/upsert';

/** Farms around Lucknow (26.8467, 80.9462), all within a 50 km radius. */
const NEIGHBOURS = [
  {
    email: 'suresh.neighbour@demo.com',
    name: 'Suresh Yadav',
    farmName: 'Yadav Farm',
    latitude: 26.9124,
    longitude: 81.0201,
    address: 'Chinhat, Lucknow',
    areaHa: 2.4,
    crop: 'rice',
    reports: [
      { disease: 'Rice Blast', severity: 'SEVERE' as const, daysAgo: 4,
        description: 'Diamond shaped lesions with grey centres spreading fast across the field' },
    ],
  },
  {
    email: 'anita.neighbour@demo.com',
    name: 'Anita Devi',
    farmName: 'Devi Fields',
    latitude: 26.7712,
    longitude: 80.8834,
    address: 'Sarojini Nagar, Lucknow',
    areaHa: 1.6,
    crop: 'rice',
    reports: [
      { disease: 'Rice Blast', severity: 'SEVERE' as const, daysAgo: 7,
        description: 'Grey spindle shaped spots on leaves, neck of some panicles turning black' },
    ],
  },
  {
    email: 'mohan.neighbour@demo.com',
    name: 'Mohan Lal',
    farmName: 'Lal Krishi',
    latitude: 27.0301,
    longitude: 80.8102,
    address: 'Malihabad, Lucknow',
    areaHa: 3.1,
    crop: 'rice',
    reports: [
      { disease: 'Rice Blast', severity: 'CRITICAL' as const, daysAgo: 2,
        description: 'Blast has taken hold, neck rot visible on many panicles, spreading daily' },
      { pest: 'Brown Planthopper', severity: 'SEVERE' as const, daysAgo: 9,
        description: 'Circular patches of drying plants, hoppers visible at the base above water' },
    ],
  },
  {
    email: 'kavita.neighbour@demo.com',
    name: 'Kavita Singh',
    farmName: 'Singh Farm',
    latitude: 26.7398,
    longitude: 81.0567,
    address: 'Gosainganj, Lucknow',
    areaHa: 2.0,
    crop: 'tomato',
    reports: [
      { disease: 'Late Blight', severity: 'CRITICAL' as const, daysAgo: 3,
        description: 'Dark water soaked patches with white fuzzy growth underneath the leaves' },
    ],
  },
  {
    email: 'rajesh.neighbour@demo.com',
    name: 'Rajesh Verma',
    farmName: 'Verma Agro',
    latitude: 26.8891,
    longitude: 80.7723,
    address: 'Kakori, Lucknow',
    areaHa: 4.2,
    crop: 'rice',
    reports: [
      { pest: 'Brown Planthopper', severity: 'SEVERE' as const, daysAgo: 6,
        description: 'Hopperburn patches appearing, dense population at plant base' },
    ],
  },
];

async function main(): Promise<void> {
  console.log('\nSeeding neighbouring farms for community outbreak alerts…\n');

  const passwordHash = await bcrypt.hash('demo1234', 10);
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  let farms = 0;
  let reports = 0;

  for (const n of NEIGHBOURS) {
    const user = await upsertWithoutTransaction(prisma.user, {
      where: { email: n.email },
      create: { email: n.email, passwordHash, name: n.name, language: 'hi', isVerified: true },
      update: {},
    });

    let farm = await prisma.farm.findFirst({ where: { userId: user.id, name: n.farmName } });
    if (!farm) {
      farm = await prisma.farm.create({
        data: {
          userId: user.id,
          name: n.farmName,
          latitude: n.latitude,
          longitude: n.longitude,
          address: n.address,
          totalAreaHectares: n.areaHa,
          soilTypePrimary: 'LOAMY',
        },
      });
    }
    farms += 1;

    let crop = await prisma.crop.findFirst({ where: { farmId: farm.id, cropName: n.crop } });
    if (!crop) {
      crop = await prisma.crop.create({
        data: {
          farmId: farm.id,
          cropName: n.crop,
          status: 'GROWING',
          growthStage: n.crop === 'rice' ? 'FLOWERING' : 'FRUIT_SET',
          plantingDate: daysAgo(n.crop === 'rice' ? 60 : 45),
        },
      });
    }

    for (const r of n.reports) {
      const observedAt = daysAgo(r.daysAgo);
      const problem = 'disease' in r ? r.disease : r.pest;

      const existing = await prisma.healthLog.findFirst({
        where: { cropId: crop.id, description: r.description },
      });
      if (existing) continue;

      await prisma.healthLog.create({
        data: {
          farmId: farm.id,
          cropId: crop.id,
          observedAt,
          observationType: 'disease' in r ? 'DISEASE' : 'PEST',
          description: r.description,
          severity: r.severity,
          status: 'ACTIVE',
          diseaseDetected: 'disease' in r ? r.disease : null,
          pestDetected: 'pest' in r ? r.pest : null,
          analysisResult: {
            summary: `Most likely ${problem?.toLowerCase()}.`,
            confidence: 0.7,
            method: 'rule-engine',
          },
          recommendedActions: ['Inspect the affected plants closely.'],
        },
      });
      reports += 1;
    }

    const distance = haversineKm(26.8467, 80.9462, n.latitude, n.longitude);
    console.log(`  ${n.farmName.padEnd(14)} ${distance.toFixed(1).padStart(5)} km  ${n.reports.length} report(s)`);
  }

  console.log(`\n  ${farms} neighbouring farms, ${reports} new reports.\n`);
  console.log('  The demo farm will now show clustered rice blast and planthopper');
  console.log('  activity in its area.\n');
}

/** Great-circle distance, for reporting how far each seeded farm sits. */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

main()
  .catch((err) => {
    logger.error({ err }, 'Community seed failed');
    console.error('\nFailed:', err instanceof Error ? err.message : err, '\n');
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
