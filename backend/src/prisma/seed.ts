/**
 * Database seed.
 *
 * Creates a demo farmer with a realistic farm so the app is immediately
 * usable — and demoable — without clicking through onboarding first.
 *
 * Run with: npm run db:seed
 */

import bcrypt from 'bcryptjs';
import { upsertWithoutTransaction } from '../common/upsert';
import { prisma } from '../common/prisma';
import { logger } from '../common/logger';
import { CROPS } from '../domain/crops';
import { seedPriceHistory } from '../modules/market/market.service';

const DEMO_EMAIL = 'farmer@demo.com';
const DEMO_PASSWORD = 'demo1234';

async function main(): Promise<void> {
  console.log('\nSeeding Smart Farm DSS…\n');

  // ── Crop varieties (agronomy reference data) ──
  let varieties = 0;
  for (const crop of CROPS) {
    await upsertWithoutTransaction(prisma.cropVariety, {
      where: { cropName: crop.key, varietyName: 'Standard' },
      create: {
        cropName: crop.key,
        varietyName: 'Standard',
        growingDays: crop.growingDays,
        waterRequirementMm: crop.waterRequirementMm,
        climateRequirements: {
          tempMinC: crop.tempRangeC.min,
          tempMaxC: crop.tempRangeC.max,
          frostSensitiveBelowC: crop.frostSensitiveBelowC,
        },
        soilRequirements: {
          preferred: crop.preferredSoils,
          rootDepthM: crop.rootDepthM,
          depletionFraction: crop.depletionFraction,
        },
        diseaseResistance: {
          knownDiseases: crop.diseases.map((d) => d.name),
          knownPests: crop.pests.map((p) => p.name),
        },
        marketInfo: { commodity: crop.commodity, priceUnit: crop.priceUnit },
        plantingWindows: { seasons: crop.seasons },
      },
      update: {},
    });
    varieties += 1;
  }
  console.log(`  Crop varieties:  ${varieties}`);

  // ── Demo farmer ──
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const user = await upsertWithoutTransaction(prisma.user, {
    where: { email: DEMO_EMAIL },
    create: {
      email: DEMO_EMAIL,
      passwordHash,
      name: 'Ramesh Kumar',
      phone: '+919876543210',
      language: 'en',
      isVerified: true,
    },
    update: { passwordHash },
  });
  console.log(`  Demo farmer:     ${user.email}`);

  // ── Demo farm (Lucknow, Uttar Pradesh) ──
  let farm = await prisma.farm.findFirst({ where: { userId: user.id, name: 'Kumar Farm' } });
  if (!farm) {
    farm = await prisma.farm.create({
      data: {
        userId: user.id,
        name: 'Kumar Farm',
        latitude: 26.8467,
        longitude: 80.9462,
        address: 'Mohanlalganj, Lucknow, Uttar Pradesh',
        totalAreaHectares: 3.2,
        soilTypePrimary: 'LOAMY',
        soilAnalysis: { ph: 7.1, nitrogen: 'medium', phosphorus: 'low', potassium: 'medium' },
      },
    });
  }
  console.log(`  Demo farm:       ${farm.name} (${farm.totalAreaHectares} ha, Lucknow)`);

  // ── Plots ──
  const plotNames = ['North Field', 'South Field'];
  const parcels = [];
  for (const [i, name] of plotNames.entries()) {
    let parcel = await prisma.parcel.findFirst({ where: { farmId: farm.id, name } });
    if (!parcel) {
      parcel = await prisma.parcel.create({
        data: {
          farmId: farm.id,
          name,
          areaHectares: i === 0 ? 2.0 : 1.2,
          soilType: i === 0 ? 'LOAMY' : 'CLAY',
          displayOrder: i,
        },
      });
    }
    parcels.push(parcel);
  }
  console.log(`  Plots:           ${parcels.map((p) => p.name).join(', ')}`);

  // ── Crops: one mid-season, one planned ──
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
  const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000);

  let rice = await prisma.crop.findFirst({ where: { farmId: farm.id, cropName: 'rice' } });
  if (!rice) {
    rice = await prisma.crop.create({
      data: {
        farmId: farm.id,
        parcelId: parcels[0].id,
        cropName: 'rice',
        status: 'GROWING',
        growthStage: 'VEGETATIVE',
        plantingDate: daysAgo(55),
        expectedHarvestDate: daysAhead(65),
        expectedYieldKg: 9000,
      },
    });
  }

  let tomato = await prisma.crop.findFirst({ where: { farmId: farm.id, cropName: 'tomato' } });
  if (!tomato) {
    tomato = await prisma.crop.create({
      data: {
        farmId: farm.id,
        parcelId: parcels[1].id,
        cropName: 'tomato',
        status: 'GROWING',
        growthStage: 'FLOWERING',
        plantingDate: daysAgo(42),
        expectedHarvestDate: daysAhead(30),
        expectedYieldKg: 24000,
      },
    });
  }
  console.log(`  Crops:           rice (vegetative), tomato (flowering)`);

  // ── An irrigation log, so the water balance has real history ──
  const existingLog = await prisma.irrigationLog.findFirst({ where: { cropId: rice.id } });
  if (!existingLog) {
    await prisma.irrigationLog.create({
      data: {
        cropId: rice.id,
        parcelId: parcels[0].id,
        irrigatedAt: daysAgo(4),
        waterAmountMm: 40,
        irrigationMethod: 'FLOOD',
        guidanceSource: 'manual',
        wasRecommended: false,
      },
    });
  }

  // ── Price history ──
  const priceRows = await seedPriceHistory(90);
  console.log(`  Price history:   ${priceRows} rows across ${CROPS.length} commodities`);

  console.log(`\nDone.\n`);
  console.log(`  Sign in with:  ${DEMO_EMAIL}  /  ${DEMO_PASSWORD}\n`);
}

main()
  .catch((err) => {
    logger.error({ err }, 'Seed failed');
    console.error('\nSeed failed:', err instanceof Error ? err.message : err, '\n');
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
