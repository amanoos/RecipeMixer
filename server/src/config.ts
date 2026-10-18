import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { checkPasswordStrength, GENERATE_PASSWORD_HINT } from './services/password.js';

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
  /** The shared password that protects the API and the photos, or null when login is off. Never logged. */
  appPassword: string | null;
  /**
   * The addresses (IPs or CIDR ranges) of the reverse proxies allowed to say who the real client is, or false for
   * none. Only a request that arrives from one of these has its X-Forwarded-For and X-Forwarded-Proto believed.
   */
  trustProxy: false | string[];
  /** "always" forces the Secure flag on the login cookie; "auto" sets it when the request arrived over HTTPS. */
  cookieSecure: 'auto' | 'always';
  /** Extra host names the app may be reached by when login is off (loopback names are always allowed). */
  allowedHosts: string[];
  /** Whether the server may fetch recipe pages and images from user-supplied URLs. */
  urlImportEnabled: boolean;
  /** Whether a recipe's title may be sent to Wikimedia Commons and Openverse to find photos (only when asked). */
  imageSearchEnabled: boolean;
  /** Whether photos with a non-commercial licence are offered. Off by default; fine for personal use. */
  imageSearchAllowNonCommercial: boolean;
  /** Whether the optional TheMealDB search is available. Off unless the owner turns it on. */
  mealdbEnabled: boolean;
  /** TheMealDB API key. The free development key is "1"; a supporter key is a secret and is never logged. */
  mealdbApiKey: string;
  isProduction: boolean;
}

const HOST_NAME = /^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:]+\])$/;

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
  // Present-but-empty is rejected on purpose: an empty value must never silently mean "no password".
  APP_PASSWORD: z.string().optional(),
  APP_PASSWORD_FILE: z.string().optional(),
  TRUST_PROXY: z.string().trim().optional(),
  COOKIE_SECURE: z.enum(['auto', 'true']).default('auto'),
  ALLOWED_HOSTS: z.string().optional(),
  URL_IMPORT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  IMAGE_SEARCH_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  IMAGE_SEARCH_ALLOW_NONCOMMERCIAL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  MEALDB_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  // The key goes into a URL path, so only plain characters are accepted. The message never repeats the value.
  MEALDB_API_KEY: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, 'must be 1 to 64 letters, digits, "-" or "_"')
    .default('1'),
  NODE_ENV: z.string().optional(),
});

const IPV4_LOOPBACK = /^127(\.\d{1,3}){3}$/;

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized === 'localhost' || normalized === '::1' || IPV4_LOOPBACK.test(normalized);
}

// server/src/config.ts and server/dist/config.js are both two levels below the repo root.
const defaultWebDist = fileURLToPath(new URL('../../web/dist', import.meta.url));

function fail(message: string): never {
  throw new Error(message);
}

/** Reads the password from APP_PASSWORD or from the file named by APP_PASSWORD_FILE (for Docker and cloud secrets). */
function readPassword(values: { APP_PASSWORD?: string | undefined; APP_PASSWORD_FILE?: string | undefined }): string | null {
  const { APP_PASSWORD: direct, APP_PASSWORD_FILE: file } = values;
  if (direct !== undefined && file !== undefined) {
    fail('Set either APP_PASSWORD or APP_PASSWORD_FILE, not both.');
  }

  let password: string;
  if (file !== undefined) {
    if (file.trim() === '') fail('APP_PASSWORD_FILE is set but empty. Remove it, or give the path of a file that holds the password.');
    try {
      // Secrets files usually end with a newline that is not part of the password.
      password = fs.readFileSync(file.trim(), 'utf8').replace(/[\r\n]+$/, '');
    } catch (err) {
      fail(`Could not read APP_PASSWORD_FILE (${(err as NodeJS.ErrnoException).code ?? 'unknown error'}).`);
    }
  } else if (direct !== undefined) {
    password = direct;
  } else {
    return null;
  }

  if (password === '') {
    fail('The app password is set but empty. Remove the setting to run without a password, or set a strong one.');
  }
  const weakness = checkPasswordStrength(password);
  if (weakness) {
    fail(
      `The app password ${weakness}. Use at least 12 characters that are hard to guess. ` +
        `To make a good one, run: ${GENERATE_PASSWORD_HINT}`,
    );
  }
  return password;
}

const PROXY_KEYWORDS = new Set(['loopback', 'linklocal', 'uniquelocal']);

function isProxyAddress(entry: string): boolean {
  if (PROXY_KEYWORDS.has(entry)) return true;
  const [address, prefix, ...rest] = entry.split('/');
  const version = net.isIP(address ?? '');
  if (version === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  return /^\d{1,3}$/.test(prefix) && Number(prefix) <= (version === 4 ? 32 : 128);
}

/** TRUST_PROXY: "false", or the proxy's own address(es) as IPs, CIDR ranges or loopback/linklocal/uniquelocal. */
function readTrustProxy(raw: string | undefined): false | string[] {
  if (raw === undefined || raw === '' || raw.toLowerCase() === 'false') return false;
  const entries = raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (entries.length === 0 || !entries.every(isProxyAddress)) {
    fail(
      'TRUST_PROXY must be "false" or the address of your reverse proxy: an IP or a CIDR range such as 172.30.0.0/24 ' +
        '(or loopback), comma-separated for several. "true" and plain numbers are refused because they let a client ' +
        'that reaches the app directly fake its address and dodge the login limits.',
    );
  }
  return entries;
}

function readAllowedHosts(raw: string | undefined): string[] {
  if (!raw) return [];
  const hosts = raw
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  for (const host of hosts) {
    if (!HOST_NAME.test(host)) fail('ALLOWED_HOSTS must be a comma-separated list of host names without ports or paths.');
  }
  return hosts;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${details}`);
  }
  const values = parsed.data;

  const appPassword = readPassword(values);

  // Listening beyond loopback needs either a password or an explicit opt-in. The opt-in exists for setups
  // such as Docker, where the container listens on 0.0.0.0 but the port is published on 127.0.0.1 only.
  if (!isLoopbackHost(values.HOST) && appPassword === null && !values.ALLOW_INSECURE_NO_AUTH) {
    throw new Error(
      `Refusing to bind to "${values.HOST}" without a password. ` +
        `Set APP_PASSWORD (or APP_PASSWORD_FILE) to a strong password, e.g. one made by: ${GENERATE_PASSWORD_HINT} ` +
        'Or use HOST=127.0.0.1. Set ALLOW_INSECURE_NO_AUTH=true only if the port is otherwise protected.',
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
    appPassword,
    trustProxy: readTrustProxy(values.TRUST_PROXY),
    cookieSecure: values.COOKIE_SECURE === 'true' ? 'always' : 'auto',
    allowedHosts: readAllowedHosts(values.ALLOWED_HOSTS),
    urlImportEnabled: values.URL_IMPORT_ENABLED,
    imageSearchEnabled: values.IMAGE_SEARCH_ENABLED,
    imageSearchAllowNonCommercial: values.IMAGE_SEARCH_ALLOW_NONCOMMERCIAL,
    mealdbEnabled: values.MEALDB_ENABLED,
    mealdbApiKey: values.MEALDB_API_KEY,
    isProduction: values.NODE_ENV === 'production',
  };
}
