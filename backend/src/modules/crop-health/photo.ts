/**
 * Authorised access to uploaded crop photos.
 *
 * These files used to be served by `express.static` mounted at `/uploads`,
 * which meant anyone holding — or guessing — a URL could read a farmer's photo
 * without signing in. A crop photo carries the farm's problems and, through the
 * filename, roughly when it was taken; it is the farmer's private record, not
 * public content.
 *
 * Serving them through here instead puts two checks in front of every byte:
 * the request must carry a valid token (the crop-health router authenticates
 * before reaching this module), and the photo must belong to a farm that the
 * requesting user owns.
 *
 * Why by filename rather than by log id: the filename is what the stored
 * `imageUrl` already contains, so existing rows keep working without a
 * migration. It is looked up rather than trusted — the row is what proves
 * ownership, and a filename matching no row is a 404 like any other.
 */

import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../../common/prisma';
import { NotFoundError, ValidationError } from '../../common/errors';
import { UPLOAD_ROOT } from '../../common/upload';

/**
 * Filenames this system generates: `<epoch-ms>-<12 hex chars>.<ext>`.
 *
 * Anchored, and with no `/`, `\` or `.` sequences permitted, so a crafted name
 * cannot escape the upload directory. The resolved path is checked against
 * `UPLOAD_ROOT` as well — belt and braces, because a regex is easy to loosen
 * later without noticing what it was load-bearing for.
 */
const FILENAME_PATTERN = /^[0-9]+-[a-f0-9]{12}\.(jpg|png|webp|heic)$/;

export interface PhotoFile {
  absolutePath: string;
  contentType: string;
}

/**
 * Resolve a photo for a specific user, or throw.
 *
 * Throws `NotFoundError` both when the photo does not exist and when it belongs
 * to somebody else. That is deliberate: a distinguishable "forbidden" would
 * confirm to a stranger that a given filename is a real photo on this server.
 */
export async function resolvePhotoForUser(filename: string, userId: string): Promise<PhotoFile> {
  if (!FILENAME_PATTERN.test(filename)) {
    throw new ValidationError('That is not a valid photo reference.');
  }

  const absolutePath = path.resolve(UPLOAD_ROOT, filename);

  // `path.resolve` collapses any `..` the regex somehow allowed through. If the
  // result is not inside the upload directory, the request is not a mistake.
  if (absolutePath !== path.join(UPLOAD_ROOT, filename)) {
    throw new ValidationError('That is not a valid photo reference.');
  }

  // The stored `imageUrl` is a full URL, so match on the filename it ends with.
  // `PUBLIC_URL` can differ between environments; the filename cannot.
  const log = await prisma.healthLog.findFirst({
    where: { imageUrl: { endsWith: `/${filename}` } },
    select: { id: true, farm: { select: { userId: true } } },
  });

  if (!log || log.farm.userId !== userId) {
    throw new NotFoundError('Photo', filename);
  }

  if (!fs.existsSync(absolutePath)) {
    // The row survived but the file did not — a wiped uploads directory on a
    // redeployed server. A 404 is honest; the alternative is a stream that
    // errors halfway through with headers already sent.
    throw new NotFoundError('Photo', filename);
  }

  return { absolutePath, contentType: contentTypeFor(filename) };
}

function contentTypeFor(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.heic':
      return 'image/heic';
    default:
      return 'image/jpeg';
  }
}
