import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../src/errors.js';
import {
  createSafeFetcher,
  FETCH_FAILED,
  MAX_PAGE_BYTES,
  parseTargetUrl,
  networkDeps,
  type FetcherDeps,
  type PinnedRequest,
  type RawResponse,
  type ResolvedAddress,
} from '../src/services/safe-fetch.js';

const PUBLIC_A = { address: '93.184.216.34', family: 4 as const };
const PUBLIC_B = { address: '2606:4700:4700::1111', family: 6 as const };

type Responder = (request: PinnedRequest) => RawResponse | Promise<RawResponse>;

function html(body: string, extra: Record<string, string> = {}, status = 200): RawResponse {
  return {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...extra },
    stream: Readable.from([Buffer.from(body)]),
  };
}

function redirect(location: string, status = 302): RawResponse {
  return { status, headers: { location }, stream: Readable.from([]) };
}

function setup(responder: Responder, hosts: Record<string, ResolvedAddress[]> = {}) {
  const lookup = vi.fn(async (hostname: string) => hosts[hostname] ?? [PUBLIC_A]);
  const send = vi.fn(async (request: PinnedRequest) => responder(request));
  const rejected: string[] = [];
  const fetcher = createSafeFetcher({
    deps: { lookup, send } satisfies FetcherDeps,
    onReject: (reason) => rejected.push(reason),
    timeoutMs: 500,
  });
  return { fetcher, lookup, send, rejected };
}

async function failure(promise: Promise<unknown>): Promise<HttpError> {
  const error = await promise.then(
    () => null,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(HttpError);
  return error as HttpError;
}

describe('parseTargetUrl', () => {
  it.each([
    'file:///etc/passwd',
    'ftp://example.com/x',
    'gopher://example.com/',
    'javascript:alert(1)',
    'data:text/html,hi',
    'not a url',
    '',
    '//example.com/x',
    `https://example.com/${'a'.repeat(2100)}`,
  ])('rejects %j', (raw) => {
    expect(() => parseTargetUrl(raw)).toThrow(HttpError);
  });

  it('rejects credentials and non-standard ports', () => {
    expect(() => parseTargetUrl('http://user:pw@example.com/')).toThrow(/user name or password/);
    expect(() => parseTargetUrl('https://user@example.com/')).toThrow(/user name or password/);
    expect(() => parseTargetUrl('http://example.com:8080/')).toThrow(/standard web ports/);
    expect(() => parseTargetUrl('http://example.com:22/')).toThrow(/standard web ports/);
    expect(() => parseTargetUrl('https://example.com:80/')).toThrow(/standard web ports/);
  });

  it('accepts ordinary addresses, including explicit default ports, and drops the fragment', () => {
    expect(parseTargetUrl('https://example.com/recipe?id=1#top').href).toBe('https://example.com/recipe?id=1');
    expect(parseTargetUrl('http://example.com:80/').port).toBe('');
    expect(parseTargetUrl('https://example.com:443/').port).toBe('');
  });
});

describe('address checks', () => {
  it.each([
    'http://127.0.0.1/',
    'http://127.1/',
    'http://2130706433/',
    'http://0x7f.0.0.1/',
    'http://0177.0.0.1/',
    'http://0.0.0.0/',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://172.16.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://[fe80::1]/',
    'http://[fc00::1]/',
    'http://[64:ff9b::7f00:1]/',
  ])('refuses %s without ever connecting', async (raw) => {
    const { fetcher, send, rejected } = setup(() => html('<html></html>'));
    const error = await failure(fetcher.fetchPage(raw));
    expect(error.statusCode).toBe(502);
    expect(error.message).toBe(FETCH_FAILED);
    expect(send).not.toHaveBeenCalled();
    expect(rejected).toHaveLength(1);
  });

  it('refuses a host whose DNS answer contains any non-public address', async () => {
    const { fetcher, send } = setup(() => html('x'), { 'mixed.example': [PUBLIC_A, { address: '10.0.0.5', family: 4 }] });
    const error = await failure(fetcher.fetchPage('https://mixed.example/'));
    expect(error.message).toBe(FETCH_FAILED);
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a host that resolves to loopback, and an unresolvable host, with the same message', async () => {
    const { fetcher } = setup(() => html('x'), { 'sneaky.example': [{ address: '127.0.0.1', family: 4 }] });
    const blocked = await failure(fetcher.fetchPage('https://sneaky.example/'));

    const lookup = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    });
    const unresolved = createSafeFetcher({ deps: { lookup, send: vi.fn() }, timeoutMs: 500 });
    const missing = await failure(unresolved.fetchPage('https://nowhere.example/'));

    expect(blocked.message).toBe(missing.message);
    expect(blocked.statusCode).toBe(missing.statusCode);
  });

  it('never repeats the address in the error message', async () => {
    const { fetcher } = setup(() => html('x'));
    const error = await failure(fetcher.fetchPage('http://169.254.169.254/secret-path'));
    expect(error.message).not.toContain('169.254');
    expect(error.message).not.toContain('secret-path');
  });
});

describe('connection pinning', () => {
  it('resolves once and connects to the address that was checked', async () => {
    let calls = 0;
    const lookup = vi.fn(async () => {
      calls += 1;
      // A rebinding attacker answers with a public address first and a private one afterwards.
      return calls === 1 ? [PUBLIC_A] : [{ address: '127.0.0.1', family: 4 as const }];
    });
    const send = vi.fn<FetcherDeps['send']>(async () => html('<p>ok</p>'));
    const fetcher = createSafeFetcher({ deps: { lookup, send }, timeoutMs: 500 });

    const result = await fetcher.fetchPage('https://rebind.example/recipe');
    expect(result.body.toString()).toBe('<p>ok</p>');
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].address).toEqual(PUBLIC_A);
  });

  it('falls back to the next checked address when a connection fails', async () => {
    const { fetcher, send } = setup(
      (request) => {
        if (request.address.family === 6) throw new Error('ENETUNREACH');
        return html('<p>ok</p>');
      },
      { 'dual.example': [PUBLIC_B, PUBLIC_A] },
    );
    const result = await fetcher.fetchPage('https://dual.example/');
    expect(result.body.toString()).toBe('<p>ok</p>');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('sends a fixed, honest request with no cookies or credentials', async () => {
    const { fetcher, send } = setup(() => html('ok'));
    await fetcher.fetchPage('https://example.com/');
    const { headers } = send.mock.calls[0]![0];
    expect(headers['User-Agent']).toMatch(/^RecipeMixer\//);
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toEqual(
      expect.arrayContaining(['cookie', 'authorization']),
    );
  });
});

describe('redirects', () => {
  it('follows a relative redirect and reports the final address', async () => {
    const { fetcher } = setup((request) =>
      request.url.pathname === '/old' ? redirect('/new') : html('<p>new</p>'),
    );
    const result = await fetcher.fetchPage('https://example.com/old');
    expect(result.url.href).toBe('https://example.com/new');
  });

  it('re-checks every hop: a redirect to loopback, a private host, or a file URL is refused', async () => {
    for (const target of ['http://127.0.0.1/admin', 'https://internal.example/', 'file:///etc/passwd', 'ftp://example.com/']) {
      const { fetcher, send } = setup(
        (request) => (request.url.hostname === 'start.example' ? redirect(target) : html('secret')),
        { 'internal.example': [{ address: '10.1.2.3', family: 4 }] },
      );
      const error = await failure(fetcher.fetchPage('https://start.example/'));
      expect(error.message).toBe(FETCH_FAILED);
      expect(send).toHaveBeenCalledTimes(1);
    }
  });

  it('refuses a redirect from https to http', async () => {
    const { fetcher, send } = setup(() => redirect('http://example.org/'));
    await failure(fetcher.fetchPage('https://example.com/'));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('allows five redirects and refuses a sixth', async () => {
    const chain = (length: number) => (request: PinnedRequest) => {
      const step = Number(request.url.searchParams.get('n') ?? '0');
      return step < length ? redirect(`/?n=${step + 1}`) : html('<p>done</p>');
    };
    const allowed = setup(chain(5));
    await expect(allowed.fetcher.fetchPage('https://example.com/')).resolves.toMatchObject({ contentType: expect.any(String) });

    const refused = setup(chain(6));
    const error = await failure(refused.fetcher.fetchPage('https://example.com/'));
    expect(error.message).toBe(FETCH_FAILED);
  });

  it('refuses a redirect with no location and a redirect to a non-standard port', async () => {
    await failure(setup(() => ({ status: 302, headers: {}, stream: Readable.from([]) })).fetcher.fetchPage('https://example.com/'));
    await failure(setup(() => redirect('https://example.com:8443/')).fetcher.fetchPage('https://example.com/'));
  });
});

describe('response limits', () => {
  it('rejects a body that grows past the limit and destroys the stream', async () => {
    const big = Readable.from([Buffer.alloc(MAX_PAGE_BYTES / 2), Buffer.alloc(MAX_PAGE_BYTES / 2), Buffer.alloc(10)]);
    const { fetcher } = setup(() => ({ status: 200, headers: { 'content-type': 'text/html' }, stream: big }));
    const error = await failure(fetcher.fetchPage('https://example.com/'));
    expect(error.message).toBe(FETCH_FAILED);
    expect(big.destroyed).toBe(true);
  });

  it('rejects a response whose declared length is already too large', async () => {
    const stream = Readable.from([Buffer.from('x')]);
    const { fetcher } = setup(() => ({
      status: 200,
      headers: { 'content-type': 'text/html', 'content-length': String(MAX_PAGE_BYTES + 1) },
      stream,
    }));
    await failure(fetcher.fetchPage('https://example.com/'));
    expect(stream.destroyed).toBe(true);
  });

  it('does not trust a content-length that understates the body', async () => {
    const { fetcher } = setup(() => ({
      status: 200,
      headers: { 'content-type': 'text/html', 'content-length': '10' },
      stream: Readable.from([Buffer.alloc(MAX_PAGE_BYTES + 1)]),
    }));
    await failure(fetcher.fetchPage('https://example.com/'));
  });

  it('decompresses gzip, deflate and brotli bodies', async () => {
    const text = '<p>compressed</p>';
    const variants: Array<[string, Buffer]> = [
      ['gzip', zlib.gzipSync(text)],
      ['deflate', zlib.deflateSync(text)],
      ['br', zlib.brotliCompressSync(text)],
    ];
    for (const [encoding, body] of variants) {
      const { fetcher } = setup(() => ({
        status: 200,
        headers: { 'content-type': 'text/html', 'content-encoding': encoding },
        stream: Readable.from([body]),
      }));
      const result = await fetcher.fetchPage('https://example.com/');
      expect(result.body.toString()).toBe(text);
    }
  });

  it('rejects a decompression bomb', async () => {
    const bomb = zlib.gzipSync(Buffer.alloc(MAX_PAGE_BYTES * 4));
    expect(bomb.length).toBeLessThan(MAX_PAGE_BYTES);
    const { fetcher } = setup(() => ({
      status: 200,
      headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' },
      stream: Readable.from([bomb]),
    }));
    const error = await failure(fetcher.fetchPage('https://example.com/'));
    expect(error.message).toBe(FETCH_FAILED);
  });

  it('rejects an unknown content encoding', async () => {
    const { fetcher } = setup(() => html('x', { 'content-encoding': 'compress' }));
    await failure(fetcher.fetchPage('https://example.com/'));
  });

  it('gives up when the server never answers', async () => {
    const { fetcher } = setup(() => new Promise<RawResponse>(() => undefined));
    const error = await failure(fetcher.fetchPage('https://example.com/'));
    expect(error.message).toBe(FETCH_FAILED);
  });

  it('gives up when the body stalls', async () => {
    const stalled = new Readable({ read() {} });
    stalled.push(Buffer.from('<html>'));
    const { fetcher } = setup(() => ({ status: 200, headers: { 'content-type': 'text/html' }, stream: stalled }));
    const error = await failure(fetcher.fetchPage('https://example.com/'));
    expect(error.message).toBe(FETCH_FAILED);
    expect(stalled.destroyed).toBe(true);
  });

  it('turns error statuses into the generic failure', async () => {
    for (const status of [403, 404, 500]) {
      const { fetcher } = setup(() => html('nope', {}, status));
      const error = await failure(fetcher.fetchPage('https://example.com/'));
      expect(error.message).toBe(FETCH_FAILED);
    }
  });

  it('accepts only web pages from fetchPage', async () => {
    const { fetcher } = setup(() => ({ status: 200, headers: { 'content-type': 'application/pdf' }, stream: Readable.from([Buffer.from('%PDF')]) }));
    const error = await failure(fetcher.fetchPage('https://example.com/menu.pdf'));
    expect(error.statusCode).toBe(422);
    expect(error.message).toBe('That address is not a web page');
  });
});

describe('fetchImage', () => {
  it('returns the bytes without trusting the declared content type', async () => {
    const { fetcher } = setup(() => ({
      status: 200,
      headers: { 'content-type': 'text/plain' },
      stream: Readable.from([Buffer.from([1, 2, 3])]),
    }));
    const result = await fetcher.fetchImage('https://example.com/photo.jpg');
    expect([...result.body]).toEqual([1, 2, 3]);
  });

  it('applies the same address checks', async () => {
    const { fetcher, send } = setup(() => html('x'));
    await failure(fetcher.fetchImage('http://10.0.0.1/photo.jpg'));
    expect(send).not.toHaveBeenCalled();
  });
});

describe('with the real network layer', () => {
  const servers: http.Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  });

  function listen(): Promise<{ port: number; hits: () => number }> {
    let hits = 0;
    const server = http.createServer((_req, res) => {
      hits += 1;
      res.setHeader('content-type', 'text/html');
      res.end('<html>secret</html>');
    });
    servers.push(server);
    return new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as AddressInfo).port, hits: () => hits }));
    });
  }

  it('connects to the pinned address, whatever the URL host says, and keeps the Host header', async () => {
    let seenHost = '';
    const server = http.createServer((req, res) => {
      seenHost = req.headers.host ?? '';
      res.setHeader('content-type', 'text/html');
      res.end('<p>pinned</p>');
    });
    servers.push(server);
    const port = await new Promise<number>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
    });

    const response = await networkDeps.send({
      url: new URL(`http://recipes.example:${port}/page`),
      address: { address: '127.0.0.1', family: 4 },
      headers: { Accept: 'text/html' },
      signal: new AbortController().signal,
    });
    const chunks: Buffer[] = [];
    for await (const chunk of response.stream) chunks.push(chunk as Buffer);

    expect(response.status).toBe(200);
    expect(Buffer.concat(chunks).toString()).toBe('<p>pinned</p>');
    expect(seenHost).toBe(`recipes.example:${port}`);
  });

  it('reaches a local server only when the address check allows it, and never when it resolves to loopback', async () => {
    const { port, hits } = await listen();
    // Every connection the fetcher makes is redirected to the local test server, so a request
    // that gets past the address guard shows up as a hit.
    const toTestServer = (request: PinnedRequest) =>
      networkDeps.send({
        ...request,
        url: new URL(`http://recipes.example:${port}${request.url.pathname}`),
        address: { address: '127.0.0.1', family: 4 },
      });
    const fetcherFor = (lookup: FetcherDeps['lookup']) =>
      createSafeFetcher({ deps: { lookup, send: toTestServer }, timeoutMs: 2000 });

    // Positive control: with a public address the request does reach the server.
    await expect(fetcherFor(async () => [PUBLIC_A]).fetchPage('http://recipes.example/')).resolves.toMatchObject({
      contentType: 'text/html',
    });
    expect(hits()).toBe(1);

    // The same request is refused, without connecting, when DNS answers with a loopback address.
    for (const address of [
      { address: '127.0.0.1', family: 4 as const },
      { address: '::1', family: 6 as const },
      { address: '::ffff:127.0.0.1', family: 6 as const },
    ]) {
      await failure(fetcherFor(async () => [address]).fetchPage('http://recipes.example/'));
    }
    // ... and when the address is typed in directly.
    for (const target of ['http://127.0.0.1/', 'http://[::1]/', 'http://localhost/']) {
      await failure(fetcherFor(async () => [{ address: '127.0.0.1', family: 4 }]).fetchPage(target));
    }
    expect(hits()).toBe(1);
  });

  it('refuses addresses with a local port before looking anything up', async () => {
    const { port, hits } = await listen();
    const fetcher = createSafeFetcher({ timeoutMs: 2000 });
    for (const target of [`http://127.0.0.1:${port}/`, `http://localhost:${port}/`, `http://[::1]:${port}/`]) {
      await expect(fetcher.fetchPage(target)).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(hits()).toBe(0);
  });
});
