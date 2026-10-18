import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// A photo found by the image search is chosen by a token the server signed, not by an address the browser sends.
// That keeps the "use this photo" route from being a way to make the server fetch any address it is handed.

const TOKEN_LIFETIME_MS = 30 * 60 * 1000;
// A token holds two addresses of up to 2048 characters and a credit of up to 300, so the longest genuine one is a
// little under 6000 characters; the limit leaves room above that.
export const MAX_TOKEN_LENGTH = 8192;

export interface CandidatePayload {
  imageUrl: string;
  creditText: string;
  creditUrl: string | null;
}

export interface CandidateTokens {
  sign(payload: CandidatePayload): string;
  /** The payload when the token is genuine and fresh; null for anything else. */
  verify(token: string): CandidatePayload | null;
}

const encode = (value: Buffer | string): string => Buffer.from(value).toString('base64url');

/**
 * Tokens are signed with a random key made when the app starts, so they stop working after a restart (nothing is
 * stored). They also expire after 30 minutes.
 */
export function createCandidateTokens(now: () => number = Date.now, key: Buffer = randomBytes(32)): CandidateTokens {
  const mac = (body: string): Buffer => createHmac('sha256', key).update(body).digest();

  return {
    sign(payload) {
      const body = encode(JSON.stringify({ ...payload, exp: now() + TOKEN_LIFETIME_MS }));
      return `${body}.${encode(mac(body))}`;
    },

    verify(token) {
      if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
      const parts = token.split('.');
      if (parts.length !== 2) return null;
      const [body, signature] = parts as [string, string];

      const given = Buffer.from(signature, 'base64url');
      const expected = mac(body);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

      try {
        const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
        if (typeof data.exp !== 'number' || data.exp < now()) return null;
        if (typeof data.imageUrl !== 'string' || typeof data.creditText !== 'string') return null;
        if (data.creditUrl !== null && typeof data.creditUrl !== 'string') return null;
        return { imageUrl: data.imageUrl, creditText: data.creditText, creditUrl: data.creditUrl };
      } catch {
        return null;
      }
    },
  };
}
