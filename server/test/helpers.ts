import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { buildApp, type AppDeps } from '../src/app.js';
import type { Config } from '../src/config.js';
import { openMemoryDatabase } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    host: '127.0.0.1',
    port: 3210,
    dataDir: path.join(os.tmpdir(), 'recipemixer-test-unused'),
    imagesDir: makeTempDir('recipemixer-images-'),
    webDist: path.join(os.tmpdir(), 'recipemixer-test-no-web-build'),
    logLevel: 'silent',
    allowInsecureNoAuth: false,
    appPassword: null,
    trustProxy: false,
    cookieSecure: 'auto',
    allowedHosts: [],
    urlImportEnabled: true,
    mealdbEnabled: false,
    mealdbApiKey: '1',
    isProduction: false,
    ...overrides,
  };
}

export async function makeApp(
  overrides: Partial<Config> = {},
  rateLimitMax?: number,
  clock?: () => number,
  extra: Partial<Pick<AppDeps, 'logStream' | 'onRoute'>> = {},
): Promise<FastifyInstance> {
  const db = openMemoryDatabase();
  migrate(db);
  return buildApp({ config: testConfig(overrides), db, rateLimitMax, clock, ...extra });
}

export function makeTempDir(prefix = 'recipemixer-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Builds a multipart/form-data body with a single file part, for use with app.inject. */
export function multipartBody(
  field: string,
  filename: string,
  contentType: string,
  data: Buffer,
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----recipemixertest${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, data, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

/** A small valid PNG generated in memory (no binary fixtures in the repo). */
export function tinyPng(width = 20, height = 10, red = 200): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: red, g: 40, b: 40 } } })
    .png()
    .toBuffer();
}
