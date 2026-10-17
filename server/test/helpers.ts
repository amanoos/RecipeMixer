import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { openMemoryDatabase } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    host: '127.0.0.1',
    port: 3000,
    dataDir: path.join(os.tmpdir(), 'recipemixer-test-unused'),
    webDist: path.join(os.tmpdir(), 'recipemixer-test-no-web-build'),
    logLevel: 'silent',
    allowInsecureNoAuth: false,
    isProduction: false,
    ...overrides,
  };
}

export async function makeApp(
  overrides: Partial<Config> = {},
  rateLimitMax?: number,
): Promise<FastifyInstance> {
  const db = openMemoryDatabase();
  migrate(db);
  return buildApp({ config: testConfig(overrides), db, rateLimitMax });
}

export function makeTempDir(prefix = 'recipemixer-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
