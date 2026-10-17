import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { createImageStore, isValidImageFilename, processImage } from '../src/services/images.js';
import { makeTempDir } from './helpers.js';

const solid = (width: number, height: number) => ({
  create: { width, height, channels: 3 as const, background: { r: 200, g: 40, b: 40 } },
});

const png = (width = 20, height = 10) => sharp(solid(width, height)).png().toBuffer();
const jpeg = (width = 20, height = 10) => sharp(solid(width, height)).jpeg().toBuffer();

describe('processImage', () => {
  it('re-encodes PNG and JPEG as WebP', async () => {
    for (const input of [await png(), await jpeg()]) {
      const { data, filename } = await processImage(input);
      expect((await sharp(data).metadata()).format).toBe('webp');
      expect(filename).toMatch(/^[a-f0-9]{64}\.webp$/);
    }
  });

  it('accepts WebP input', async () => {
    const input = await sharp(solid(20, 10)).webp().toBuffer();
    const { data } = await processImage(input);
    expect((await sharp(data).metadata()).format).toBe('webp');
  });

  it('shrinks large images so the long edge is at most 1600px', async () => {
    const { data } = await processImage(await png(3000, 2000));
    const meta = await sharp(data).metadata();
    expect(meta.width).toBe(1600);
    expect(meta.height).toBeLessThanOrEqual(1067);
  });

  it('does not enlarge small images', async () => {
    const { data } = await processImage(await png(100, 50));
    const meta = await sharp(data).metadata();
    expect([meta.width, meta.height]).toEqual([100, 50]);
  });

  it('strips EXIF metadata such as copyright and description', async () => {
    const withExif = await sharp(solid(20, 10))
      .jpeg()
      .withExif({ IFD0: { Copyright: 'secret-owner', ImageDescription: 'secret-place' } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const { data } = await processImage(withExif);
    expect((await sharp(data).metadata()).exif).toBeUndefined();
    expect(data.toString('latin1')).not.toContain('secret-owner');
  });

  it('applies EXIF orientation before stripping it', async () => {
    const rotated = await sharp(solid(40, 20)).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const { data } = await processImage(rotated);
    const meta = await sharp(data).metadata();
    expect([meta.width, meta.height]).toEqual([20, 40]);
  });

  it('gives identical bytes the identical filename and different bytes a different one', async () => {
    const a = await processImage(await png(20, 10));
    const b = await processImage(await png(20, 10));
    const c = await processImage(await png(30, 10));
    expect(a.filename).toBe(b.filename);
    expect(a.filename).not.toBe(c.filename);
  });

  it('rejects SVG without invoking an image decoder', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    await expect(processImage(svg)).rejects.toMatchObject({ statusCode: 415 });
  });

  it('rejects text, GIF and empty input', async () => {
    await expect(processImage(Buffer.from('just some text'))).rejects.toMatchObject({ statusCode: 415 });
    await expect(processImage(Buffer.from('GIF89a......'))).rejects.toMatchObject({ statusCode: 415 });
    await expect(processImage(Buffer.alloc(0))).rejects.toMatchObject({ statusCode: 415 });
  });

  it('rejects a truncated image', async () => {
    const whole = await png(200, 200);
    await expect(processImage(whole.subarray(0, Math.floor(whole.length / 2)))).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('rejects an image above the pixel limit', async () => {
    await expect(processImage(await png(100, 100), { maxInputPixels: 50 })).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

describe('isValidImageFilename', () => {
  it.each(['a'.repeat(64) + '.webp', '0123456789abcdef'.repeat(4) + '.webp'])('accepts %s', (name) => {
    expect(isValidImageFilename(name)).toBe(true);
  });

  it.each(['../x.webp', 'a/b.webp', 'x.webp', 'A'.repeat(64) + '.webp', 'a'.repeat(64) + '.png', 'a'.repeat(64)])(
    'rejects %s',
    (name) => {
      expect(isValidImageFilename(name)).toBe(false);
    },
  );
});

describe('createImageStore', () => {
  const name = (char: string) => `${char.repeat(64)}.webp`;

  it('creates its directory lazily, saves and finds files', async () => {
    const dir = path.join(makeTempDir(), 'images');
    const store = createImageStore(dir);
    expect(fs.existsSync(dir)).toBe(false);
    expect(await store.exists(name('a'))).toBe(false);

    await store.save(name('a'), Buffer.from('one'));
    expect(await store.exists(name('a'))).toBe(true);
    expect(fs.readFileSync(store.pathFor(name('a')), 'utf8')).toBe('one');
  });

  it('leaves no temporary files behind and keeps an existing file untouched', async () => {
    const dir = makeTempDir();
    const store = createImageStore(dir);
    await store.save(name('b'), Buffer.from('first'));
    await store.save(name('b'), Buffer.from('second'));
    expect(fs.readdirSync(dir)).toEqual([name('b')]);
    expect(fs.readFileSync(store.pathFor(name('b')), 'utf8')).toBe('first');
  });

  it('handles concurrent saves of the same file', async () => {
    const dir = makeTempDir();
    const store = createImageStore(dir);
    await Promise.all([1, 2, 3, 4].map(() => store.save(name('c'), Buffer.from('same'))));
    expect(fs.readdirSync(dir)).toEqual([name('c')]);
  });

  it('removes files and ignores missing ones', async () => {
    const store = createImageStore(makeTempDir());
    await store.save(name('d'), Buffer.from('x'));
    await store.remove(name('d'));
    expect(await store.exists(name('d'))).toBe(false);
    await expect(store.remove(name('d'))).resolves.toBeUndefined();
  });

  it.each(['../x.webp', 'a/b.webp', '..\\x.webp', 'plain.webp'])('rejects the filename %s everywhere', async (bad) => {
    const store = createImageStore(makeTempDir());
    expect(() => store.pathFor(bad)).toThrow();
    await expect(store.save(bad, Buffer.from('x'))).rejects.toThrow();
    await expect(store.remove(bad)).rejects.toThrow();
    await expect(store.exists(bad)).rejects.toThrow();
  });
});
