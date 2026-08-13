import { PrismaClient } from '@prisma/client';

/**
 * Prisma client singleton.
 *
 * Cached on `globalThis` in development so `tsx watch` hot reloads reuse one
 * client instead of opening a new connection pool on every file change.
 */
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  global.__prisma ??
  new PrismaClient({
    // Query-level logging is extremely noisy on MongoDB (every findFirst in a
    // seed run). Warnings and errors are what actually matter during dev.
    log: ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}

export default prisma;
