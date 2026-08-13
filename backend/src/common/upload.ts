import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { config } from '../config';
import { ValidationError } from './errors';

/**
 * Crop photo uploads.
 *
 * Files are written to local disk and served statically. This keeps the demo
 * free of an object-storage dependency; swapping in S3 or Cloudinary means
 * replacing only `storage` and `publicUrl` below.
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
}

/** Persist an uploaded buffer and return its public URL plus base64 payload. */
export function storeImage(file: Express.Multer.File): StoredImage {
  const ext = extensionFor(file.mimetype);
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  const destination = path.join(UPLOAD_ROOT, filename);

  fs.writeFileSync(destination, file.buffer);

  return {
    filename,
    url: `${config.PUBLIC_URL.replace(/\/$/, '')}/uploads/${filename}`,
    base64: file.buffer.toString('base64'),
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
