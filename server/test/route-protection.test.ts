import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { FastifyInstance, RouteOptions } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { makeApp, makeTempDir } from './helpers.js';

const PASSWORD = 'correct-horse-battery-staple';

/**
 * Every protected API route, written out by hand. If a route is added to the app and not listed here, the
 * first test fails, so nobody can add an open route by accident.
 */
const PROTECTED = [
  'GET /api/recipes',
  'POST /api/recipes',
  'GET /api/recipes/:id',
  'PUT /api/recipes/:id',
  'DELETE /api/recipes/:id',
  'PATCH /api/recipes/:id/rating',
  'PUT /api/recipes/:id/image',
  'DELETE /api/recipes/:id/image',
  'POST /api/recipes/:id/image/from-url',
  'GET /api/cuisines',
  'GET /api/match',
  'GET /api/ingredients/suggest',
  'POST /api/import/preview',
  'POST /api/starter-recipes',
  'GET /api/image-search',
  'POST /api/recipes/:id/image/from-search',
  'GET /api/mealdb/search',
  'GET /api/mealdb/meals/:id',
  'GET /api/images/:filename',
];

/** The only API routes that work without a login. */
const PUBLIC = ['GET /api/health', 'GET /api/session', 'POST /api/session', 'DELETE /api/session'];

let app: FastifyInstance;
let collected: RouteOptions[];

afterEach(async () => {
  await app?.close();
});

async function start(extraRoutes?: (instance: FastifyInstance) => void) {
  collected = [];
  const webDist = makeTempDir('recipemixer-web-');
  fs.writeFileSync(path.join(webDist, 'index.html'), '<!doctype html><title>RecipeMixer</title>');
  fs.mkdirSync(path.join(webDist, 'assets'));
  fs.writeFileSync(path.join(webDist, 'assets', 'app.js'), 'console.log(1);');
  app = await makeApp({ appPassword: PASSWORD, webDist, mealdbEnabled: true }, undefined, undefined, { onRoute: (route) => collected.push(route) });
  extraRoutes?.(app);
  await app.ready();
  return app;
}

const methodsOf = (route: RouteOptions): string[] => (Array.isArray(route.method) ? route.method : [route.method]);

function apiRoutes(): string[] {
  return collected
    .flatMap((route) => methodsOf(route).map((method) => `${method} ${route.url}`))
    .filter((entry) => entry.split(' ')[1]!.startsWith('/api') && !entry.startsWith('HEAD '))
    .sort();
}

const concrete = (url: string) => url.replace(':id', '1').replace(':filename', `${'a'.repeat(64)}.webp`);

async function login(): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/session', payload: { password: PASSWORD } });
  const cookie = res.cookies[0]!;
  return `${cookie.name}=${cookie.value}`;
}

describe('every route is accounted for', () => {
  it('lists exactly the routes in the app, so a new route cannot be forgotten', async () => {
    await start();
    expect(apiRoutes()).toEqual([...PROTECTED, ...PUBLIC].sort());
  });

  it('has no routes outside /api except the static web app', async () => {
    await start();
    const others = collected
      .flatMap((route) => methodsOf(route).map((method) => `${method} ${route.url}`))
      .filter((entry) => !entry.split(' ')[1]!.startsWith('/api'));
    for (const entry of others) expect(entry).toMatch(/^(GET|HEAD) (\/|\/\*)$/);
  });
});

describe('with a password set', () => {
  it.each(PROTECTED)('%s answers 401 without a login and reaches its handler with one', async (entry) => {
    await start();
    const [method, route] = entry.split(' ') as [string, string];
    const url = concrete(route!);

    const refused = await app.inject({ method: method as 'GET', url, payload: method === 'GET' || method === 'DELETE' ? undefined : {} });
    expect(refused.statusCode).toBe(401);
    expect(refused.json()).toEqual({ error: 'Login required' });

    const cookie = await login();
    const allowed = await app.inject({
      method: method as 'GET',
      url,
      headers: { cookie },
      payload: method === 'GET' || method === 'DELETE' ? undefined : {},
    });
    expect([401, 403]).not.toContain(allowed.statusCode);
  });

  it('refuses a route added later, because the protection is on the whole app', async () => {
    await start((instance) => {
      instance.get('/api/added-later', async () => ({ secret: 'data' }));
      instance.post('/api/also-later', async () => ({ secret: 'data' }));
    });
    const get = await app.inject({ method: 'GET', url: '/api/added-later' });
    const post = await app.inject({ method: 'POST', url: '/api/also-later', payload: {} });
    expect(get.statusCode).toBe(401);
    expect(post.statusCode).toBe(401);
    expect(get.body).not.toContain('data');
    expect((await app.inject({ method: 'GET', url: '/api/added-later', headers: { cookie: await login() } })).json()).toEqual({ secret: 'data' });
  });

  it('answers 401, never 404, for paths that do not exist, so nothing can be probed', async () => {
    await start();
    for (const url of ['/api', '/api/', '/api/nope', '/api/recipes/1/nope', '/api/session/x', '/api/health/', '/api/healthz']) {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE'] as const) {
        const res = await app.inject({ method, url, payload: method === 'GET' ? undefined : {} });
        expect(res.statusCode, `${method} ${url}`).toBe(401);
      }
    }
  });

  it.each([
    '/api//recipes',
    '//api/recipes',
    '/API/recipes',
    '/Api/Recipes',
    '/%61pi/recipes',
    '/api%2Frecipes',
    '/api/recipes/',
    '/api/recipes/../health',
    '/api/recipes/%2e%2e/health',
    '/api/recipes%00',
    '/api/recipes;x=1',
    '/api/recipes?x=/api/health',
    '/api/health;x',
    '/api/session/..',
    '/api/images/../recipes',
  ])('does not let %s past the login', async (url) => {
    await start();
    const res = await app.inject({ method: 'GET', url });
    // either the login stops it, or it is plainly not an API request and gets the web page or a 404, never data
    expect([401, 404, 200]).toContain(res.statusCode);
    expect(res.body).not.toContain('"items"');
    expect(res.body).not.toContain('schemaVersion');
  });

  it.each(['/api//recipes', '//api/recipes', '/API/recipes', '/%61pi/recipes', '/api%2Frecipes'])(
    'treats %s as an API request and asks for a login',
    async (url) => {
      await start();
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(401);
    },
  );

  it('rejects a malformed percent-encoding before any handler can run', async () => {
    await start();
    for (const url of ['/%', '/api/%zz', '/api/recipes/%', '/%E0%A4%A']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(400);
      expect(res.body).not.toContain('items');
    }
  });

  it('answers a HEAD request like a GET: refused, except for health', async () => {
    await start();
    expect((await app.inject({ method: 'HEAD', url: '/api/recipes' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'HEAD', url: '/api/images/' + 'a'.repeat(64) + '.webp' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'HEAD', url: '/api/health' })).statusCode).toBe(200);
  });

  it('refuses a preflight (OPTIONS) request to protected routes', async () => {
    await start();
    expect((await app.inject({ method: 'OPTIONS', url: '/api/recipes' })).statusCode).toBe(401);
  });

  it('keeps the public routes public, and only those', async () => {
    await start();
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/session' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: '/api/session' })).statusCode).toBe(204);
    const wrong = await app.inject({ method: 'POST', url: '/api/session', payload: { password: 'not-the-password-1' } });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ error: 'Incorrect password' });
    // other methods on the public paths are not public
    expect((await app.inject({ method: 'PUT', url: '/api/session', payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/health', payload: {} })).statusCode).toBe(401);
  });

  it('still serves the web app itself, which holds no data', async () => {
    await start();
    expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/recipes/1' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/assets/app.js' })).statusCode).toBe(200);
  });
});

/** Sends raw HTTP over a real socket, because app.inject only ever builds well-formed, path-only request lines. */
function rawRequest(port: number, lines: string[], body = ''): Promise<{ status: string; body: string }> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`${lines.join('\r\n')}\r\n\r\n${body}`);
    });
    let data = '';
    socket.on('data', (chunk) => (data += chunk));
    socket.on('close', () => {
      const split = data.indexOf('\r\n\r\n');
      resolve({
        status: (split === -1 ? data : data.slice(0, split)).split('\r\n')[0] ?? '',
        body: split === -1 ? '' : data.slice(split + 4),
      });
    });
  });
}

const getLines = (target: string) => [`GET ${target} HTTP/1.1`, 'Host: localhost', 'Connection: close'];

describe('request lines in unusual forms, over a real socket', () => {
  async function listening() {
    await start();
    await app.listen({ port: 0, host: '127.0.0.1' });
    return (app.server.address() as net.AddressInfo).port;
  }

  it('behaves as expected for the plain form, as a control', async () => {
    const port = await listening();
    expect((await rawRequest(port, getLines('/api/recipes'))).status).toContain('401');
    expect((await rawRequest(port, getLines('/api/health'))).status).toContain('200');
  });

  it.each([
    'http://x/api/recipes',
    'http://x:80/api/recipes',
    'https://x/api/recipes',
    'HTTP://x/api/recipes',
    'http://localhost/api/cuisines',
    `http://x/api/images/${'a'.repeat(64)}.webp`,
    '*',
  ])('does not let a full-address request for %s past the login', async (target) => {
    const port = await listening();
    const { status, body } = await rawRequest(port, getLines(target));
    expect(status).not.toContain('200');
    expect(body).not.toContain('"items"');
    expect(body).not.toContain('"imageUrl"');
  });

  it('does not let a full-address HEAD request past the login either', async () => {
    const port = await listening();
    const { status } = await rawRequest(port, ['HEAD http://x/api/recipes HTTP/1.1', 'Host: localhost', 'Connection: close']);
    expect(status).not.toContain('200');
  });

  it.each([
    ['POST', 'http://x/api/recipes', '{"title":"Planted"}'],
    ['PUT', 'http://x/api/recipes/1', '{"title":"Changed","ingredients":[],"steps":[]}'],
    ['PATCH', 'http://x/api/recipes/1/rating', '{"rating":5}'],
    ['DELETE', 'http://x/api/recipes/1', ''],
    ['POST', 'http://x/api/import/preview', '{"url":"https://example.com/"}'],
  ])('does not let a full-address %s to %s change anything without a login', async (method, target, payload) => {
    const port = await listening();
    const cookie = await login();
    const created = await app.inject({ method: 'POST', url: '/api/recipes', headers: { cookie }, payload: { title: 'Original' } });
    expect(created.statusCode).toBe(201);

    const { status } = await rawRequest(
      port,
      [
        `${method} ${target} HTTP/1.1`,
        'Host: localhost',
        'Connection: close',
        'Origin: http://evil.example',
        'Sec-Fetch-Site: cross-site',
        'Content-Type: application/json',
        `Content-Length: ${Buffer.byteLength(payload)}`,
      ],
      payload,
    );
    expect(status).toMatch(/ (401|403) /);

    const list = (await app.inject({ method: 'GET', url: '/api/recipes', headers: { cookie } })).json() as {
      total: number;
      items: { title: string; rating: number | null }[];
    };
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ title: 'Original', rating: null });
  });

  it('applies the cross-site check to a full-address request when no password is set', async () => {
    collected = [];
    app = await makeApp({ appPassword: null }, undefined, undefined, { onRoute: (route) => collected.push(route) });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as net.AddressInfo).port;

    const payload = '{"title":"Planted"}';
    const { status } = await rawRequest(
      port,
      [
        'POST http://x/api/recipes HTTP/1.1',
        'Host: localhost',
        'Connection: close',
        'Origin: http://evil.example',
        'Sec-Fetch-Site: cross-site',
        'Content-Type: application/json',
        `Content-Length: ${payload.length}`,
      ],
      payload,
    );
    expect(status).toContain('403');
    expect((await app.inject({ method: 'GET', url: '/api/recipes' })).json().total).toBe(0);
  });
});
