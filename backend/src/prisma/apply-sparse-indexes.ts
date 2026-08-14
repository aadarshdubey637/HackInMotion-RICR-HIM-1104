/**
 * Apply the sparse unique indexes Prisma cannot declare.
 *
 * `User.username` and `User.phone` identify exactly one farmer, but Prisma has no
 * syntax for a *sparse* unique index and a plain `@unique` on a nullable field is
 * unusable on MongoDB: a missing field indexes as null, so the second account
 * without a username collides with the first. Every Google Sign-In account has
 * no username, so that is not a corner case — it is most of them.
 *
 * Run this after `prisma db push`, every time. Push syncs indexes to exactly what
 * the schema declares and reports these two as `[-] Unique index ...` on its way
 * to deleting them, so they need reapplying rather than creating once:
 *
 *     npm run db:push && npm run db:indexes
 *
 * Without them the application-level check in `auth.service.ts`
 * (`assertIdentifiersAreFree`) is the only guard, which leaves a race window of a
 * few milliseconds between the check and the insert. With them, a lost race
 * surfaces as P2002, which `register` already turns into the same friendly
 * "already taken" message.
 *
 * Duplicates already in the collection make an index build fail — deliberately,
 * because silently tolerating them would defeat the point. This script reports
 * which values clash instead of leaving a raw E11000 to be decoded.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Sparse unique indexes to maintain, keyed by the MongoDB field name. */
const INDEXES = [
  { field: 'username', name: 'users_username_sparse_unique' },
  { field: 'phone', name: 'users_phone_sparse_unique' },
] as const;

/**
 * Values held by more than one document. Reported before an index build is
 * attempted, so the failure names the rows to fix rather than one example key.
 */
async function findDuplicates(field: string): Promise<Array<{ value: string; count: number }>> {
  const result = (await prisma.$runCommandRaw({
    aggregate: 'users',
    pipeline: [
      { $match: { [field]: { $ne: null, $exists: true } } },
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } },
    ],
    cursor: {},
  })) as { cursor?: { firstBatch?: Array<{ _id: string; count: number }> } };

  return (result.cursor?.firstBatch ?? []).map((row) => ({ value: row._id, count: row.count }));
}

async function main(): Promise<void> {
  let failed = false;

  for (const { field, name } of INDEXES) {
    const duplicates = await findDuplicates(field);

    if (duplicates.length > 0) {
      failed = true;
      console.error(`\n  ✗ users.${field} — cannot make unique, ${duplicates.length} duplicated value(s):`);
      for (const { value, count } of duplicates) {
        console.error(`      ${value}  (${count} accounts)`);
      }
      console.error(
        `    Leave the duplicates and users.${field} stays non-unique, guarded only by\n` +
          `    the application check. Resolve them, then re-run this script.`,
      );
      continue;
    }

    try {
      await prisma.$runCommandRaw({
        createIndexes: 'users',
        indexes: [
          {
            key: { [field]: 1 },
            name,
            unique: true,
            // Skips documents where the field is absent entirely, which is what
            // makes this coexist with the null-heavy Google accounts.
            sparse: true,
          },
        ],
      });
      console.log(`  ✓ users.${field} — sparse unique index ready (${name})`);
    } catch (error) {
      failed = true;
      console.error(`  ✗ users.${field} — ${(error as Error).message}`);
    }
  }

  if (failed) {
    console.error('\n  Some indexes were not applied. See above.\n');
    process.exitCode = 1;
    return;
  }

  console.log('\n  Sparse unique indexes applied. Re-run after every `prisma db push`.\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
