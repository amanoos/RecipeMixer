import { Writable } from 'node:stream';
import { buildApp } from '../src/app.js';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { makeApp, multipartBody, testConfig, tinyPng } from './helpers.js';

const PASSWORD = 'correct-horse-battery-staple';
const WRONG = 'definitely-the-wrong-one-123';
const DAY = 24 * 60 * 60 * 1000;

let app: FastifyInstance;
let now: number;
const clock = () => now;

afterEach(async () => {
  await app?.close();
});

async function start(overrides: Parameters<typeof testConfig>[0] = {}, extra = {}) {
  now = 1_800_000_000_000;
  app = await makeApp({ appPassword: PASSWORD, ...overrides }, undefined, clock, extra);
  return app;
}

const login = (password = PASSWORD, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/api/session', payload: { password }, headers });

/** "name=value" for the session cookie a login response set, ready to send back. */
function cookieFrom(res: LightMyRequestResponse): string {
  const set = res.cookies.find((cookie) => cookie.name.endsWith('rm_session'));
  expect(set).toBeDefined();
  return `${set!.name}=${set!.value}`;
}

async function loggedIn(headers: Record<string, string> = {}): Promise<string> {
  const res = await login(PASSWORD, headers);
  expect(res.statusCode).toBe(204);
  return cookieFrom(res);
}

const get = (url: string, cookie?: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url, headers: { ...(cookie ? { cookie } : {}), ...headers } });

describe('who am I', () => {
  it('says a password is needed and that this caller is not logged in', async () => {
    await start();
    const res = await get('/api/session');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ authRequired: true, authenticated: false, features: { mealdb: false } });
  });

  it('says this caller is logged in after login', async () => {
    await start();
    const cookie = await loggedIn();
    expect((await get('/api/session', cookie)).json()).toEqual({ authRequired: true, authenticated: true, features: { mealdb: false } });
  });

  it('says no password is needed when none is set', async () => {
    await start({ appPassword: null });
    expect((await get('/api/session')).json()).toEqual({ authRequired: false, authenticated: true, features: { mealdb: false } });
    expect((await login()).statusCode).toBe(204);
  });
});

describe('logging in', () => {
  it('sets a locked-down session cookie and opens the API', async () => {
    await start();
    expect((await get('/api/recipes')).statusCode).toBe(401);

    const res = await login();
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    const header = String(res.headers['set-cookie']);
    expect(header).toMatch(/^rm_session=[A-Za-z0-9_-]{43};/);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Strict');
    expect(header).toContain('Path=/');
    expect(header).toContain('Max-Age=2592000');
    expect(header).not.toContain('Secure');

    expect((await get('/api/recipes', cookieFrom(res))).statusCode).toBe(200);
  });

  it('answers a wrong password with the same generic message every time, and no cookie', async () => {
    await start();
    const answers = await Promise.all(['x', WRONG, `${PASSWORD} `, PASSWORD.toUpperCase()].map((password) => login(password)));
    for (const res of answers) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'Incorrect password' });
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  it.each([undefined, {}, { password: '' }, { password: 5 }, { password: 'x'.repeat(201) }, { password: PASSWORD, extra: 1 }])(
    'rejects the malformed login body %j',
    async (body) => {
      await start();
      const res = await app.inject({ method: 'POST', url: '/api/session', payload: body as object });
      expect(res.statusCode).toBe(400);
      expect(res.body).not.toContain(PASSWORD);
    },
  );

  it('gives every login its own session', async () => {
    await start();
    const first = await loggedIn();
    const second = await loggedIn();
    expect(first).not.toBe(second);
    expect((await get('/api/recipes', first)).statusCode).toBe(200);
    expect((await get('/api/recipes', second)).statusCode).toBe(200);
  });

  it('refuses a made-up cookie, and a secure-named cookie over plain http', async () => {
    await start();
    const cookie = await loggedIn();
    const token = cookie.split('=')[1]!;
    expect((await get('/api/recipes', 'rm_session=not-a-real-token')).statusCode).toBe(401);
    expect((await get('/api/recipes', `__Host-rm_session=${token}`)).statusCode).toBe(401);
    expect((await get('/api/recipes', `other=1; rm_session=${token}`)).statusCode).toBe(200);
  });
});

describe('the cookie over HTTPS', () => {
  it('is Secure with the __Host- prefix when a trusted proxy says the request was HTTPS', async () => {
    await start({ trustProxy: ['127.0.0.1'] });
    const res = await login(PASSWORD, { 'x-forwarded-proto': 'https' });
    const header = String(res.headers['set-cookie']);
    expect(header).toMatch(/^__Host-rm_session=/);
    expect(header).toContain('Secure');
    expect(header).toContain('Path=/');
    expect(header).not.toMatch(/Domain=/i);

    const cookie = cookieFrom(res);
    expect((await get('/api/recipes', cookie, { 'x-forwarded-proto': 'https' })).statusCode).toBe(200);
    // the secure cookie is not accepted over plain http
    expect((await get('/api/recipes', cookie)).statusCode).toBe(401);
  });

  it('ignores X-Forwarded-Proto when no proxy is trusted', async () => {
    await start();
    const res = await login(PASSWORD, { 'x-forwarded-proto': 'https' });
    expect(String(res.headers['set-cookie'])).toMatch(/^rm_session=/);
    expect(String(res.headers['set-cookie'])).not.toContain('Secure');
  });

  it('is always Secure when COOKIE_SECURE=true, even over http', async () => {
    await start({ cookieSecure: 'always' });
    const header = String((await login()).headers['set-cookie']);
    expect(header).toMatch(/^__Host-rm_session=/);
    expect(header).toContain('Secure');
  });
});

describe('guessing the password', () => {
  it('locks an address after five wrong passwords, even for the right one, and unlocks after 15 minutes', async () => {
    await start();
    for (let i = 0; i < 5; i++) expect((await login(WRONG)).statusCode).toBe(401);

    const locked = await login(PASSWORD);
    expect(locked.statusCode).toBe(429);
    expect(locked.headers['retry-after']).toBe('900');
    expect(locked.json().error).toMatch(/Too many wrong passwords/);
    expect(locked.headers['set-cookie']).toBeUndefined();

    now += 14 * 60 * 1000;
    expect((await login(PASSWORD)).statusCode).toBe(429);
    now += 60 * 1000;
    expect((await login(PASSWORD)).statusCode).toBe(204);
  });

  it('locks only the address that guessed, so a stranger cannot lock the owner out', async () => {
    await start({ trustProxy: ['127.0.0.1'] });
    for (let i = 0; i < 5; i++) await login(WRONG, { 'x-forwarded-for': '198.51.100.7' });
    expect((await login(PASSWORD, { 'x-forwarded-for': '198.51.100.7' })).statusCode).toBe(429);
    expect((await login(PASSWORD, { 'x-forwarded-for': '203.0.113.9' })).statusCode).toBe(204);
  });

  it('cannot be dodged by faking X-Forwarded-For when no proxy is trusted', async () => {
    await start();
    for (let i = 0; i < 5; i++) await login(WRONG, { 'x-forwarded-for': `198.51.100.${i}` });
    expect((await login(PASSWORD, { 'x-forwarded-for': '203.0.113.99' })).statusCode).toBe(429);
  });

  it('treats every address in one IPv6 range as the same client, so a whole range cannot be used to keep guessing', async () => {
    await start({ trustProxy: ['127.0.0.1'] });
    for (let i = 0; i < 5; i++) await login(WRONG, { 'x-forwarded-for': `2001:db8:aaaa:bbbb::${i + 1}` });
    const sameRange = await login(PASSWORD, { 'x-forwarded-for': '2001:db8:aaaa:bbbb:dead:beef:0:1' });
    expect(sameRange.statusCode).toBe(429);
    expect((await login(PASSWORD, { 'x-forwarded-for': '2001:db8:aaaa:cccc::1' })).statusCode).toBe(204);
  });

  it('makes login attempts wait, without locking anyone, after a burst of wrong passwords from many clients', async () => {
    await start({ trustProxy: ['127.0.0.1'] });
    for (let i = 0; i < 50; i++) await login(WRONG, { 'x-forwarded-for': `198.51.${i >> 8}.${i & 255}` });

    const started = Date.now();
    const res = await login(PASSWORD, { 'x-forwarded-for': '203.0.113.200' });
    expect(res.statusCode).toBe(204);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });

  it('counts an IPv6 range as one client for the login request limit as well', async () => {
    await start({ trustProxy: ['127.0.0.1'] });
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await login(PASSWORD, { 'x-forwarded-for': `2001:db8:5:6::${i + 1}` })).statusCode);
    }
    expect(statuses.slice(0, 10).every((status) => status === 204)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it('counts an IPv6 range as one client for the general request limit too', async () => {
    now = 1_800_000_000_000;
    app = await makeApp({ appPassword: PASSWORD, trustProxy: ['127.0.0.1'] }, 5, clock);
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      statuses.push((await get('/api/health', undefined, { 'x-forwarded-for': `2001:db8:7:8::${i + 1}` })).statusCode);
    }
    expect(statuses.slice(0, 5).every((status) => status === 200)).toBe(true);
    expect(statuses.slice(5).every((status) => status === 429)).toBe(true);
    // a different range has its own allowance
    expect((await get('/api/health', undefined, { 'x-forwarded-for': '2001:db8:9:9::1' })).statusCode).toBe(200);
  });

  it('still stops a burst of parallel guesses from one client at the lockout, even while the slow-down is on', async () => {
    await start({ trustProxy: ['127.0.0.1'] });
    for (let i = 0; i < 50; i++) await login(WRONG, { 'x-forwarded-for': `198.51.${i >> 8}.${i & 255}` });

    const burst = await Promise.all(
      Array.from({ length: 9 }, () => login(WRONG, { 'x-forwarded-for': '203.0.113.50' })),
    );
    const statuses = burst.map((res) => res.statusCode);
    expect(statuses.filter((status) => status === 401)).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(4);
    // and the right password from that client is now refused until the lock ends
    expect((await login(PASSWORD, { 'x-forwarded-for': '203.0.113.50' })).statusCode).toBe(429);
  });

  it('forgets earlier failures after a correct password', async () => {
    await start();
    for (let i = 0; i < 4; i++) await login(WRONG);
    expect((await login(PASSWORD)).statusCode).toBe(204);
    for (let i = 0; i < 4; i++) await login(WRONG);
    expect((await login(PASSWORD)).statusCode).toBe(204);
  });

  it('has its own request limit as well, ten login calls a minute', async () => {
    await start();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await login(PASSWORD, { 'x-forwarded-for': `10.0.0.${i}` })).statusCode);
    expect(statuses.slice(0, 10).every((status) => status === 204)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});

describe('logging out and expiry', () => {
  it('ends the session on the server and clears the cookie', async () => {
    await start();
    const cookie = await loggedIn();
    const res = await app.inject({ method: 'DELETE', url: '/api/session', headers: { cookie } });
    expect(res.statusCode).toBe(204);
    const cleared = String(res.headers['set-cookie']);
    expect(cleared).toMatch(/^rm_session=;/);
    expect(cleared).toMatch(/Expires=|Max-Age=0/);

    // the old cookie is dead even if someone kept a copy of it
    expect((await get('/api/recipes', cookie)).statusCode).toBe(401);
  });

  it('asks the browser to empty its cache for the site, so photos are not left on a shared device', async () => {
    await start();
    const res = await app.inject({ method: 'DELETE', url: '/api/session', headers: { cookie: await loggedIn() } });
    expect(res.headers['clear-site-data']).toBe('"cache"');
  });

  it('is harmless when nobody was logged in', async () => {
    await start();
    expect((await app.inject({ method: 'DELETE', url: '/api/session' })).statusCode).toBe(204);
  });

  it('ends a session after a week of not using it, but not while it is used', async () => {
    await start();
    const cookie = await loggedIn();
    for (let day = 0; day < 20; day++) {
      now += DAY;
      expect((await get('/api/recipes', cookie)).statusCode).toBe(200);
    }
    now += 8 * DAY;
    expect((await get('/api/recipes', cookie)).statusCode).toBe(401);
  });

  it('ends a session 30 days after login however much it is used', async () => {
    await start();
    const cookie = await loggedIn();
    for (let day = 0; day < 30; day++) {
      now += DAY;
      expect((await get('/api/recipes', cookie)).statusCode).toBe(200);
    }
    now += DAY;
    expect((await get('/api/recipes', cookie)).statusCode).toBe(401);
  });

  it('ends every session when the password changes', async () => {
    const db = openMemoryDatabase();
    migrate(db);
    now = 1_800_000_000_000;

    const before = await buildApp({ config: testConfig({ appPassword: PASSWORD }), db, clock });
    const cookie = cookieFrom(
      await before.inject({ method: 'POST', url: '/api/session', payload: { password: PASSWORD } }),
    );
    expect((await before.inject({ method: 'GET', url: '/api/recipes', headers: { cookie } })).statusCode).toBe(200);
    await before.close();

    app = await buildApp({ config: testConfig({ appPassword: 'a-brand-new-password-2' }), db, clock });
    expect((await get('/api/recipes', cookie)).statusCode).toBe(401);

    // while the same password after a restart keeps its sessions
    const same = await buildApp({ config: testConfig({ appPassword: PASSWORD }), db, clock });
    expect((await same.inject({ method: 'GET', url: '/api/recipes', headers: { cookie } })).statusCode).toBe(200);
    await same.close();
  });
});

describe('a proxy in front that the app has not been told about', () => {
  async function startLogged(overrides: Parameters<typeof testConfig>[0] = {}) {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    await start({ logLevel: 'warn', ...overrides }, { logStream: stream });
    return () => lines.filter((line) => line.includes('TRUST_PROXY is not set')).length;
  }

  it('warns once, in the log, when proxy headers arrive but TRUST_PROXY is not set', async () => {
    const warnings = await startLogged();
    await get('/api/health', undefined, { 'x-forwarded-for': '203.0.113.9' });
    await get('/api/health', undefined, { 'x-forwarded-proto': 'https' });
    await get('/api/health', undefined, { 'x-forwarded-for': '203.0.113.9' });
    expect(warnings()).toBe(1);
  });

  it('says nothing when there are no proxy headers, or when the proxy is trusted', async () => {
    const quiet = await startLogged();
    await get('/api/health');
    expect(quiet()).toBe(0);
    await app.close();

    const trusted = await startLogged({ trustProxy: ['127.0.0.1'] });
    await get('/api/health', undefined, { 'x-forwarded-for': '203.0.113.9', 'x-forwarded-proto': 'https' });
    expect(trusted()).toBe(0);
  });
});

describe('what the log and the answers reveal', () => {
  it('never contains the password, a wrong guess, a session token or the cookie', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    await start({ logLevel: 'info' }, { logStream: stream });

    await login(WRONG);
    const res = await login(PASSWORD);
    const cookie = cookieFrom(res);
    const token = cookie.split('=')[1]!;
    await get('/api/recipes', cookie);
    await app.inject({ method: 'DELETE', url: '/api/session', headers: { cookie } });

    const log = lines.join('');
    expect(log).toContain('login failed');
    for (const secret of [PASSWORD, WRONG, token, cookie]) expect(log).not.toContain(secret);
  });

  it('never repeats the password in a response', async () => {
    await start();
    const cookie = await loggedIn();
    for (const res of [await login(WRONG), await get('/api/session', cookie), await get('/api/health', cookie)]) {
      expect(res.body).not.toContain(PASSWORD);
    }
  });
});

describe('health', () => {
  it('tells a logged-out caller only that the server is up', async () => {
    await start();
    const res = await get('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('gives the schema version to a logged-in caller, and to anyone when no password is set', async () => {
    await start();
    expect((await get('/api/health', await loggedIn())).json()).toEqual({ status: 'ok', schemaVersion: 5 });

    await app.close();
    await start({ appPassword: null });
    expect((await get('/api/health')).json()).toEqual({ status: 'ok', schemaVersion: 5 });
  });
});

describe('cross-site requests', () => {
  const recipe = { title: 'Soup' };

  async function post(headers: Record<string, string>, cookie?: string) {
    return app.inject({
      method: 'POST',
      url: '/api/recipes',
      payload: recipe,
      headers: { ...(cookie ? { cookie } : {}), host: 'recipes.example', ...headers },
    });
  }

  it.each([
    ['a cross-site fetch', { 'sec-fetch-site': 'cross-site' }],
    ['a same-site (other subdomain) fetch', { 'sec-fetch-site': 'same-site' }],
    ['another origin', { origin: 'https://evil.example' }],
    ['the "null" origin', { origin: 'null' }],
    ['an origin that only starts like the real one', { origin: 'https://recipes.example.evil.example' }],
    ['an unusable origin', { origin: 'not a url' }],
  ])('refuses %s even with a valid session', async (_name, headers) => {
    await start();
    const cookie = await loggedIn({ host: 'recipes.example' });
    const res = await post(headers, cookie);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'Cross-site requests are not allowed.' });
  });

  it.each([
    ['a same-origin fetch', { 'sec-fetch-site': 'same-origin', origin: 'http://recipes.example' }],
    ['typing the address (no site)', { 'sec-fetch-site': 'none' }],
    ['a script with no browser headers', {}],
    ['the matching origin only', { origin: 'http://recipes.example' }],
  ])('accepts %s', async (_name, headers) => {
    await start();
    const cookie = await loggedIn({ host: 'recipes.example' });
    expect((await post(headers, cookie)).statusCode).toBe(201);
  });

  it('checks every kind of change, not just POST', async () => {
    await start();
    const cookie = await loggedIn({ host: 'recipes.example' });
    const headers = { cookie, host: 'recipes.example', 'sec-fetch-site': 'cross-site' };
    for (const [method, url] of [
      ['PUT', '/api/recipes/1'],
      ['PATCH', '/api/recipes/1/rating'],
      ['DELETE', '/api/recipes/1'],
      ['PUT', '/api/recipes/1/image'],
      ['DELETE', '/api/recipes/1/image'],
      ['POST', '/api/import/preview'],
      ['POST', '/api/recipes/1/image/from-url'],
    ] as const) {
      const res = await app.inject({ method, url, headers });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it('still asks for a login first when there is no session', async () => {
    await start();
    expect((await post({ 'sec-fetch-site': 'cross-site' })).statusCode).toBe(401);
  });

  it('believes X-Forwarded-Host only from a trusted proxy', async () => {
    await start({ trustProxy: ['127.0.0.1'] });
    const cookie = await loggedIn({ host: 'upstream:3210', 'x-forwarded-host': 'recipes.example' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/recipes',
      payload: recipe,
      headers: { cookie, host: 'upstream:3210', 'x-forwarded-host': 'recipes.example', origin: 'https://recipes.example' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('is also on when no password is set', async () => {
    await start({ appPassword: null });
    const res = await app.inject({ method: 'POST', url: '/api/recipes', payload: recipe, headers: { 'sec-fetch-site': 'cross-site' } });
    expect(res.statusCode).toBe(403);
  });
});

describe('reaching the app by name while no password is set (DNS rebinding)', () => {
  beforeEach(async () => {
    await start({ appPassword: null });
  });

  it.each(['localhost', 'localhost:3210', 'LOCALHOST:80', '127.0.0.1:3210', '127.0.0.5', '[::1]:3210'])('allows %s', async (host) => {
    expect((await get('/api/recipes', undefined, { host })).statusCode).toBe(200);
  });

  it.each(['evil.example', 'evil.example:3210', 'localhost.evil.example', '192.168.1.5:3210', '10.0.0.1', 'foo.localhost'])(
    'refuses %s with an explanation',
    async (host) => {
      const res = await get('/api/recipes', undefined, { host });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatch(/ALLOWED_HOSTS/);
      expect((await get('/', undefined, { host })).statusCode).toBe(403);
    },
  );

  it('allows the names the owner lists', async () => {
    await app.close();
    await start({ appPassword: null, allowedHosts: ['pi.local', '192.168.1.5'] });
    expect((await get('/api/recipes', undefined, { host: 'pi.local:3210' })).statusCode).toBe(200);
    expect((await get('/api/recipes', undefined, { host: '192.168.1.5:3210' })).statusCode).toBe(200);
    expect((await get('/api/recipes', undefined, { host: 'other.local' })).statusCode).toBe(403);
  });

  it('is not applied when a password protects the app', async () => {
    await app.close();
    await start();
    expect((await get('/api/session', undefined, { host: 'recipes.example.com' })).statusCode).toBe(200);
    expect((await get('/api/recipes', undefined, { host: 'recipes.example.com' })).statusCode).toBe(401);
  });
});

describe('what browsers and proxies may keep', () => {
  it('marks every API answer private and not storable, and every response with a permissions policy', async () => {
    await start({ appPassword: null });
    for (const url of ['/api/recipes', '/api/cuisines', '/api/health', '/api/session', '/api/nope']) {
      const res = await get(url);
      expect(res.headers['cache-control'], url).toBe('private, no-store');
      expect(res.headers['permissions-policy'], url).toContain('camera=()');
    }
  });

  it('marks even a login error private and not storable', async () => {
    await start();
    expect((await get('/api/recipes')).headers['cache-control']).toBe('private, no-store');
    expect((await login(WRONG)).headers['cache-control']).toBe('private, no-store');
  });

  it('lets a browser, but never a shared cache, keep stored photos', async () => {
    await start();
    const cookie = await loggedIn();
    const created = await app.inject({ method: 'POST', url: '/api/recipes', payload: { title: 'Soup' }, headers: { cookie } });
    const { id } = created.json() as { id: number };
    const upload = multipartBody('image', 'p.png', 'image/png', await tinyPng());
    const saved = await app.inject({ method: 'PUT', url: `/api/recipes/${id}/image`, headers: { ...upload.headers, cookie }, payload: upload.payload });
    const { imageUrl } = saved.json() as { imageUrl: string };

    const photo = await get(imageUrl, cookie);
    expect(photo.statusCode).toBe(200);
    expect(photo.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(String(photo.headers['cache-control'])).not.toMatch(/public/);

    // and the photo itself is behind the login
    expect((await get(imageUrl)).statusCode).toBe(401);
  });
});

