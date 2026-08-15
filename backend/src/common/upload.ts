import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { config } from '../config';
import { ValidationError } from './errors';

/**
 * Crop photo uploads.
 *
 * Files are written to local disk. This keeps the demo free of an
 * object-storage dependency; swapping in S3 or Cloudinary means replacing only
 * `storage` and the URL built in `storeImage` below.
 *
 * They are *not* served statically. The URL points at an authenticated route
 * that checks farm ownership before streaming — see `crop-health/photo.ts`.
 *
 * Images are kept in memory as well as on disk so the crop-health service can
 * forward the bytes to an image-analysis API without a second read.
 */

const UPLOAD_ROOT = path.resolve(process.cwd(), config.UPLOAD_DIR);

// Created eagerly so a first upload never races on directory creation.
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB — generous for a phone photo

/**
 * Memory storage, not disk storage: we need the buffer for the analysis API,
 * and writing to disk ourselves lets us control the filename and handle
 * write failures gracefully.
 */
export const cropPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new ValidationError('Please upload a JPG, PNG or WebP image'));
      return;
    }
    cb(null, true);
  },
}).single('image');

export interface StoredImage {
  url: string;
  base64: string;
  filename: string;
  /**
   * The browser-declared MIME type, already validated against `ALLOWED_MIME`.
   *
   * Hosted vision providers have to be told what they are being handed; they
   * cannot infer it from a bare base64 payload the way a local model reading
   * the bytes can.
   */
  mimeType: string;
}

/** Persist an uploaded buffer and return its public URL plus base64 payload. */
export function storeImage(file: Express.Multer.File): StoredImage {
  const ext = extensionFor(file.mimetype);
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  const destination = path.join(UPLOAD_ROOT, filename);

  fs.writeFileSync(destination, file.buffer);

  return {
    filename,
    // Points at the authenticated streaming route, not a static directory.
    // Rows written before this change still hold `/uploads/<filename>`; the
    // client reads only the trailing filename, so both shapes resolve.
    url: `${config.PUBLIC_URL.replace(/\/$/, '')}/api/crop-health/photo/${filename}`,
    base64: file.buffer.toString('base64'),
    mimeType: file.mimetype,
  };
}

function extensionFor(mimetype: string): string {
  switch (mimetype) {
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/heic':
      return '.heic';
    default:
      return '.jpg';
  }
}

export { UPLOAD_ROOT };
