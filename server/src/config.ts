import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;

export interface Config {
  host: string;
  port: number;
  dataDir: string;
  /** Recipe images live in a dedicated folder inside the data directory. */
  imagesDir: string;
  webDist: string;
  logLevel: (typeof LOG_LEVELS)[number];
  allowInsecureNoAuth: boolean;
  /** Whether the server may fetch recipe pages and images from user-supplied URLs. */
  urlImportEnabled: boolean;
  isProduction: boolean;
}

const envSchema = z.object({
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3210),
  DATA_DIR: z.string().trim().min(1).default('./data'),
  WEB_DIST: z.string().trim().min(1).optional(),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  ALLOW_INSECURE_NO_AUTH: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  URL_IMPORT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  NODE_ENV: z.string().optional(),
});

const IPV4_LOOPBACK = /^127(\.\d{1,3}){3}$/;

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized === 'localhost' || normalized === '::1' || IPV4_LOOPBACK.test(normalized);
}

// server/src/config.ts and server/dist/config.js are both two levels below the repo root.
const defaultWebDist = fileURLToPath(new URL('../../web/dist', import.meta.url));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${details}`);
  }
  const values = parsed.data;

  // There is no authentication yet (planned for a later phase), so APP_PASSWORD-style
  // settings must NOT satisfy this guard: only an explicit opt-in lets the server
  // listen beyond loopback, e.g. inside a container whose port is published on 127.0.0.1 only.
  if (!isLoopbackHost(values.HOST) && !values.ALLOW_INSECURE_NO_AUTH) {
    throw new Error(
      `Refusing to bind to "${values.HOST}" without authentication. ` +
        'Use HOST=127.0.0.1, or set ALLOW_INSECURE_NO_AUTH=true only if the port is otherwise protected.',
    );
  }

  const dataDir = path.resolve(values.DATA_DIR);

  return {
    host: values.HOST,
    port: values.PORT,
    dataDir,
    imagesDir: path.join(dataDir, 'images'),
    webDist: path.resolve(values.WEB_DIST ?? defaultWebDist),
    logLevel: values.LOG_LEVEL,
    allowInsecureNoAuth: values.ALLOW_INSECURE_NO_AUTH,
    urlImportEnabled: values.URL_IMPORT_ENABLED,
    isProduction: values.NODE_ENV === 'production',
  };
}
