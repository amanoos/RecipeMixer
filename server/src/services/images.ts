import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { badRequest, unsupportedMediaType } from '../errors.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_INPUT_PIXELS = 40_000_000;
export const MAX_EDGE = 1600;

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);

/**
 * A small picture can expand to a very large bitmap while it is decoded (a 40-megapixel one needs well over
 * 100 MB), so only a couple are decoded at the same time; the rest wait their turn.
 */
const MAX_CONCURRENT_DECODES = 2;
let activeDecodes = 0;
const waitingDecodes: Array<() => void> = [];

async function withDecodeSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeDecodes < MAX_CONCURRENT_DECODES) {
    activeDecodes += 1;
  } else {
    // The slot is handed over directly by the call that finishes, so the count stays accurate.
    await new Promise<void>((resolve) => waitingDecodes.push(resolve));
  }
  try {
    return await work();
  } finally {
    const next = waitingDecodes.shift();
    if (next) next();
    else activeDecodes -= 1;
  }
}
const IMAGE_FILENAME = /^[a-f0-9]{64}\.webp$/;

export function isValidImageFilename(filename: string): boolean {
  return IMAGE_FILENAME.test(filename);
}

/** Identifies JPEG, PNG and WebP from their leading bytes, without invoking any decoder. */
function sniffFormat(buf: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return 'webp';
  }
  return null;
}

const CORRUPT = 'Unsupported or corrupt image';

/**
 * Validates an untrusted upload and re-encodes it as a bounded WebP.
 * The format is decided from the file's bytes (never the client's claim), SVG and animated
 * formats are refused, metadata such as EXIF/GPS is dropped, and the result is named by its hash.
 */
export async function processImage(
  input: Buffer,
  options: { maxInputPixels?: number; maxEdge?: number } = {},
): Promise<{ data: Buffer; filename: string }> {
  if (!sniffFormat(input)) {
    throw unsupportedMediaType('Only JPEG, PNG and WebP images are supported');
  }

  const data = await withDecodeSlot(async () => {
    const image = sharp(input, {
      limitInputPixels: options.maxInputPixels ?? MAX_INPUT_PIXELS,
      failOn: 'error',
      animated: false,
      // (Reading is sequential by default; stated here so it stays that way. Memory is bounded by the pixel limit above
      // and by the two-at-a-time limit on decoding, not by this.)
      sequentialRead: true,
    });

    let format: string | undefined;
    try {
      format = (await image.metadata()).format;
    } catch {
      throw badRequest(CORRUPT);
    }
    if (!format || !ALLOWED_FORMATS.has(format)) {
      throw unsupportedMediaType('Only JPEG, PNG and WebP images are supported');
    }

    try {
      return await image
        .rotate()
        .resize({
          width: options.maxEdge ?? MAX_EDGE,
          height: options.maxEdge ?? MAX_EDGE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      throw badRequest(CORRUPT);
    }
  });

  return { data, filename: `${createHash('sha256').update(data).digest('hex')}.webp` };
}

export interface ImageStore {
  save(filename: string, data: Buffer): Promise<void>;
  remove(filename: string): Promise<void>;
  exists(filename: string): Promise<boolean>;
  pathFor(filename: string): string;
}

/** Content-addressed image files in one flat directory. Every call re-validates the filename. */
export function createImageStore(dir: string): ImageStore {
  function pathFor(filename: string): string {
    if (!IMAGE_FILENAME.test(filename)) throw new Error('Invalid image filename');
    return path.join(dir, filename);
  }

  async function exists(filename: string): Promise<boolean> {
    try {
      await fs.access(pathFor(filename));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  return {
    pathFor,
    exists,

    async save(filename, data) {
      const target = pathFor(filename);
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      if (await exists(filename)) return;

      // Write to a temporary name, then rename, so readers never see a partial file.
      const temp = path.join(dir, `.tmp-${randomBytes(8).toString('hex')}`);
      await fs.writeFile(temp, data, { mode: 0o600 });
      try {
        await fs.rename(temp, target);
      } catch (err) {
        await fs.rm(temp, { force: true });
        // A concurrent save of identical bytes may have won the race; that is fine.
        if (!(await exists(filename))) throw err;
      }
    },

    async remove(filename) {
      try {
        await fs.unlink(pathFor(filename));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    },
  };
}
