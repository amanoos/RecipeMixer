import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { Readable } from 'node:stream';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { badGateway, badRequest, unprocessable } from '../errors.js';
import { MAX_IMAGE_BYTES } from './images.js';
import { isPublicAddress } from './ip-guard.js';

/**
 * The only code in the server that fetches a user-supplied URL.
 *
 * Controls (see SECURITY.md): http(s) on the default ports only, every resolved address must be
 * public, the connection is pinned to the checked address (no DNS rebinding), redirects are followed
 * by hand and re-checked, and size, decompressed size and total time are capped. Every failure that
 * could reveal something about the network gives the same generic message.
 */

export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
export const MAX_REDIRECTS = 5;
export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_URL_LENGTH = 2048;
export const MAX_JSON_BYTES = 1024 * 1024;
const MAX_ADDRESSES_TRIED = 4;
export const USER_AGENT = 'RecipeMixer/0.1 (+https://github.com/amanoos/RecipeMixer)';

export const FETCH_FAILED = 'Could not fetch that page';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface PinnedRequest {
  url: URL;
  address: ResolvedAddress;
  headers: Record<string, string>;
  signal: AbortSignal;
}

export interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  stream: Readable;
}

/** The two things that touch the network; tests replace them. */
export interface FetcherDeps {
  lookup(hostname: string): Promise<ResolvedAddress[]>;
  send(request: PinnedRequest): Promise<RawResponse>;
}

export interface FetchedBody {
  /** The address that finally answered, after any redirects. */
  url: URL;
  contentType: string;
  body: Buffer;
}

export interface SafeFetcher {
  fetchPage(url: string): Promise<FetchedBody>;
  fetchImage(url: string): Promise<FetchedBody>;
  /** Fetches a JSON document from a web API and returns it parsed. Any failure looks like any other fetch failure. */
  fetchJson(url: string): Promise<unknown>;
}

export interface SafeFetcherOptions {
  deps?: FetcherDeps;
  /** Called with the internal reason whenever a target is refused or fails; never sent to clients. */
  onReject?: (reason: string) => void;
  timeoutMs?: number;
}

const stripBrackets = (hostname: string): string => hostname.replace(/^\[|\]$/g, '');

/** Validates the address the user typed. These messages describe the user's own input, not the network. */
export function parseTargetUrl(raw: string): URL {
  const invalid = badRequest('Enter a web address that starts with http:// or https://');
  if (raw.length > MAX_URL_LENGTH) throw invalid;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalid;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalid;
  if (!url.hostname) throw invalid;
  if (url.username || url.password) {
    throw badRequest('Web addresses that contain a user name or password are not supported');
  }
  // The URL parser drops a scheme's default port, so any remaining port is a non-standard one.
  if (url.port !== '') throw badRequest('Only the standard web ports (80 and 443) are supported');
  url.hash = '';
  return url;
}

/** The real DNS and socket layer. Exported so tests can exercise it against a local socket. */
export const networkDeps: FetcherDeps = {
  async lookup(hostname) {
    const results = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    return results.map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 }));
  },

  send(request) {
    return new Promise((resolve, reject) => {
      const { url, address } = request;
      const hostname = stripBrackets(url.hostname);
      const client = url.protocol === 'https:' ? https : http;

      const outgoing = client.request(
        {
          method: 'GET',
          host: hostname,
          port: url.port === '' ? undefined : Number(url.port),
          path: `${url.pathname}${url.search}`,
          headers: { ...request.headers, Host: url.host },
          // A fresh connection every time, so a pinned socket is never reused for another host.
          agent: false,
          // Connect to the address that was already checked, whatever DNS says now.
          lookup: (_host, options, callback) => {
            if (options.all) {
              (callback as unknown as (err: null, addresses: dns.LookupAddress[]) => void)(null, [
                { address: address.address, family: address.family },
              ]);
            } else {
              callback(null, address.address, address.family);
            }
          },
          servername: net.isIP(hostname) ? undefined : hostname,
          signal: request.signal,
        },
        (response) => resolve({ status: response.statusCode ?? 0, headers: response.headers, stream: response }),
      );
      outgoing.setTimeout(FETCH_TIMEOUT_MS, () => outgoing.destroy(new Error('socket idle timeout')));
      outgoing.on('error', reject);
      outgoing.end();
    });
  },
};

const gunzip = promisify(zlib.gunzip) as (buf: Buffer, options: zlib.ZlibOptions) => Promise<Buffer>;
const inflate = promisify(zlib.inflate) as (buf: Buffer, options: zlib.ZlibOptions) => Promise<Buffer>;
const inflateRaw = promisify(zlib.inflateRaw) as (buf: Buffer, options: zlib.ZlibOptions) => Promise<Buffer>;
const brotli = promisify(zlib.brotliDecompress) as (buf: Buffer, options: zlib.BrotliOptions) => Promise<Buffer>;

async function decompress(body: Buffer, encoding: string, maxBytes: number): Promise<Buffer> {
  switch (encoding) {
    case '':
    case 'identity':
      return body;
    case 'gzip':
    case 'x-gzip':
      return gunzip(body, { maxOutputLength: maxBytes });
    case 'deflate':
      // Some servers send raw deflate without the zlib wrapper.
      return inflate(body, { maxOutputLength: maxBytes }).catch(() => inflateRaw(body, { maxOutputLength: maxBytes }));
    case 'br':
      return brotli(body, { maxOutputLength: maxBytes });
    default:
      throw new Error(`unsupported content-encoding ${encoding}`);
  }
}

/** Reads a stream into memory, destroying it the moment it exceeds the limit or the deadline passes. */
function readLimited(stream: Readable, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      action();
    };
    const fail = (message: string) =>
      finish(() => {
        stream.destroy();
        reject(new Error(message));
      });
    function onAbort() {
      fail('deadline exceeded while reading');
    }

    if (signal.aborted) return fail('deadline exceeded');
    signal.addEventListener('abort', onAbort, { once: true });

    stream.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) return fail('response too large');
      chunks.push(chunk);
    });
    stream.on('end', () => finish(() => resolve(Buffer.concat(chunks))));
    stream.on('error', (err: Error) => fail(`stream error: ${err.message}`));
    stream.on('close', () => fail('connection closed early'));
  });
}

/** Rejects as soon as the deadline passes, even if the underlying operation ignores the signal. */
function untilDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('deadline exceeded'));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

const headerValue = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value)?.trim() ?? '';

interface GetOptions {
  maxBytes: number;
  accept: string;
  /** Returns true when the response content type is acceptable. */
  contentTypeOk?: (contentType: string) => boolean;
  notAcceptable?: string;
}

/** True for application/json and application/*+json, judged by the media type alone, not by its parameters. */
export function isJsonType(contentType: string): boolean {
  const mediaType = (contentType.split(';')[0] ?? '').trim().toLowerCase();
  return mediaType === 'application/json' || /^application\/[a-z0-9.-]+\+json$/.test(mediaType);
}

export function createSafeFetcher(options: SafeFetcherOptions = {}): SafeFetcher {
  const deps = options.deps ?? networkDeps;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const report = options.onReject ?? (() => undefined);

  const refuse = (reason: string): never => {
    report(reason);
    throw badGateway(FETCH_FAILED);
  };

  /** Resolves a hostname and requires every address to be public. */
  async function resolvePublic(url: URL, signal: AbortSignal): Promise<ResolvedAddress[]> {
    const hostname = stripBrackets(url.hostname);
    const literal = net.isIP(hostname);

    let addresses: ResolvedAddress[];
    if (literal) {
      addresses = [{ address: hostname, family: literal === 6 ? 6 : 4 }];
    } else {
      try {
        addresses = await untilDeadline(deps.lookup(hostname), signal);
      } catch (err) {
        return refuse(`could not resolve ${hostname}: ${(err as Error).message}`);
      }
    }

    if (addresses.length === 0) return refuse(`no addresses for ${hostname}`);
    const blocked = addresses.find((entry) => !isPublicAddress(entry.address));
    if (blocked) return refuse(`${hostname} resolves to a non-public address (${blocked.address})`);
    return addresses.slice(0, MAX_ADDRESSES_TRIED);
  }

  async function connect(url: URL, addresses: ResolvedAddress[], headers: Record<string, string>, signal: AbortSignal) {
    let lastError: unknown;
    for (const address of addresses) {
      try {
        return await untilDeadline(deps.send({ url, address, headers, signal }), signal);
      } catch (err) {
        lastError = err;
        if (signal.aborted) break;
      }
    }
    return refuse(`connection failed: ${(lastError as Error | undefined)?.message ?? 'unknown error'}`);
  }

  async function guardedGet(start: URL, get: GetOptions): Promise<FetchedBody> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const { signal } = controller;

    try {
      let url = start;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const addresses = await resolvePublic(url, signal);
        const response = await connect(
          url,
          addresses,
          {
            Accept: get.accept,
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept-Language': 'en',
            'User-Agent': USER_AGENT,
          },
          signal,
        );

        if (REDIRECT_STATUSES.has(response.status)) {
          response.stream.destroy();
          const location = headerValue(response.headers.location);
          if (!location) return refuse('redirect without a location');
          let next: URL;
          try {
            next = parseTargetUrl(new URL(location, url).href);
          } catch {
            return refuse('redirect to an unusable address');
          }
          if (url.protocol === 'https:' && next.protocol === 'http:') return refuse('redirect downgrades https to http');
          url = next;
          continue;
        }

        if (response.status < 200 || response.status > 299) {
          response.stream.destroy();
          return refuse(`unexpected status ${response.status}`);
        }

        const contentType = headerValue(response.headers['content-type']).toLowerCase();
        if (get.contentTypeOk && !get.contentTypeOk(contentType)) {
          response.stream.destroy();
          throw unprocessable(get.notAcceptable ?? FETCH_FAILED);
        }

        const declaredLength = Number(headerValue(response.headers['content-length']));
        if (Number.isFinite(declaredLength) && declaredLength > get.maxBytes) {
          response.stream.destroy();
          return refuse('declared content length is too large');
        }

        try {
          const raw = await readLimited(response.stream, get.maxBytes, signal);
          const encoding = headerValue(response.headers['content-encoding']).toLowerCase();
          const body = await decompress(raw, encoding, get.maxBytes);
          return { url, contentType, body };
        } catch (err) {
          return refuse(`reading the response failed: ${(err as Error).message}`);
        }
      }
      return refuse('too many redirects');
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  return {
    fetchPage: async (raw) =>
      guardedGet(parseTargetUrl(raw), {
        maxBytes: MAX_PAGE_BYTES,
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        contentTypeOk: (type) => type.startsWith('text/html') || type.startsWith('application/xhtml+xml'),
        notAcceptable: 'That address is not a web page',
      }),

    fetchJson: async (raw) => {
      const fetched = await guardedGet(parseTargetUrl(raw), {
        maxBytes: MAX_JSON_BYTES,
        accept: 'application/json',
        contentTypeOk: isJsonType,
        notAcceptable: FETCH_FAILED,
      });
      try {
        return JSON.parse(fetched.body.toString('utf8')) as unknown;
      } catch {
        return refuse('response was not valid JSON');
      }
    },

    // The content type is not trusted here: processImage decides from the bytes.
    fetchImage: async (raw) =>
      guardedGet(parseTargetUrl(raw), {
        maxBytes: MAX_IMAGE_BYTES,
        accept: 'image/webp,image/png,image/jpeg;q=0.9,*/*;q=0.1',
      }),
  };
}
