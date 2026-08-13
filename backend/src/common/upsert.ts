/**
 * Transaction-free upsert.
 *
 * Prisma's built-in `upsert()` wraps its read-then-write in a transaction, and
 * MongoDB only supports transactions when running as a replica set. A plain
 * standalone `mongod` — the default local install — therefore fails every
 * upsert with P2031.
 *
 * Rather than requiring every developer (and the demo machine) to reconfigure
 * MongoDB as a single-node replica set, this helper performs the same logical
 * operation with independent read / update / create calls. It works on
 * standalone MongoDB, on a replica set, and on Atlas without any change.
 *
 * Concurrency: two callers racing on the same key can both miss the read and
 * both attempt a create. The loser hits the unique index and gets P2002, which
 * we catch and convert into an update — so the outcome matches a real upsert.
 * That is the only race worth handling here; these writes are idempotent
 * caches and dedupe records, not financial transactions.
 */

import { Prisma } from '@prisma/client';

/** Minimal shape shared by every Prisma model delegate we use this with. */
interface Delegate<TWhere, TCreate, TUpdate, TResult> {
  findFirst(args: { where: TWhere }): Promise<TResult | null>;
  create(args: { data: TCreate }): Promise<TResult>;
  update(args: { where: { id: string }; data: TUpdate }): Promise<TResult>;
}

interface HasId {
  id: string;
}

export async function upsertWithoutTransaction<
  TWhere,
  TCreate,
  TUpdate,
  TResult extends HasId,
>(
  delegate: Delegate<TWhere, TCreate, TUpdate, TResult>,
  args: { where: TWhere; create: TCreate; update: TUpdate },
): Promise<TResult> {
  const existing = await delegate.findFirst({ where: args.where });

  if (existing) {
    return delegate.update({ where: { id: existing.id }, data: args.update });
  }

  try {
    return await delegate.create({ data: args.create });
  } catch (err) {
    // Lost a race against a concurrent create — fall back to updating the row
    // the other caller just inserted.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const now = await delegate.findFirst({ where: args.where });
      if (now) {
        return delegate.update({ where: { id: now.id }, data: args.update });
      }
    }
    throw err;
  }
}
