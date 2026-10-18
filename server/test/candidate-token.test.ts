import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createCandidateTokens, MAX_TOKEN_LENGTH, type CandidatePayload } from '../src/services/candidate-token.js';

const PAYLOAD: CandidatePayload = {
  imageUrl: 'https://upload.wikimedia.org/a.jpg',
  creditText: 'Photo: "A" by B, CC BY 2.0, via Openverse',
  creditUrl: 'https://example.org/a',
};

const MINUTE = 60_000;

describe('candidate tokens', () => {
  it('give back what was signed', () => {
    const tokens = createCandidateTokens();
    expect(tokens.verify(tokens.sign(PAYLOAD))).toEqual(PAYLOAD);
  });

  it('carry a missing credit link as null', () => {
    const tokens = createCandidateTokens();
    expect(tokens.verify(tokens.sign({ ...PAYLOAD, creditUrl: null }))).toEqual({ ...PAYLOAD, creditUrl: null });
  });

  it('are refused when any part is changed', () => {
    const tokens = createCandidateTokens();
    const [body, signature] = tokens.sign(PAYLOAD).split('.') as [string, string];

    const forged = Buffer.from(JSON.stringify({ ...PAYLOAD, imageUrl: 'http://169.254.169.254/latest/meta-data', exp: Date.now() + MINUTE })).toString('base64url');
    expect(tokens.verify(`${forged}.${signature}`)).toBeNull();
    expect(tokens.verify(`${body}.${signature.slice(0, -2)}AA`)).toBeNull();
    expect(tokens.verify(`${body}x.${signature}`)).toBeNull();
    expect(tokens.verify(`${body}.`)).toBeNull();
  });

  it('are refused when signed by another app (a different key), or after a restart', () => {
    const token = createCandidateTokens().sign(PAYLOAD);
    expect(createCandidateTokens().verify(token)).toBeNull();
  });

  it('work with the same key and stop after 30 minutes', () => {
    let now = 1_000_000;
    const key = Buffer.alloc(32, 7);
    const tokens = createCandidateTokens(() => now, key);
    const token = tokens.sign(PAYLOAD);

    now += 29 * MINUTE;
    expect(tokens.verify(token)).toEqual(PAYLOAD);
    now += 2 * MINUTE;
    expect(tokens.verify(token)).toBeNull();
  });

  it.each(['', 'x', 'a.b.c', '.', '..', 'not a token', '%%%.%%%', 'a'.repeat(5000), `${'a'.repeat(3000)}.${'b'.repeat(3000)}`])('refuse the nonsense %j', (token) => {
    expect(createCandidateTokens().verify(token)).toBeNull();
  });

  it.each([undefined, null, 5, {}, []])('refuse a non-string %j', (value) => {
    expect(createCandidateTokens().verify(value as never)).toBeNull();
  });

  it('refuse a genuine signature over a body of the wrong shape', () => {
    // Signed with the same key, but not a payload this app made: still refused.
    const key = Buffer.alloc(32, 9);
    const tokens = createCandidateTokens(() => 1, key);
    for (const body of [{ exp: 2 }, { exp: 2, imageUrl: 5, creditText: 'x', creditUrl: null }, { exp: 'soon', imageUrl: 'https://a', creditText: 'x', creditUrl: null }, { exp: 2, imageUrl: 'https://a', creditText: 'x', creditUrl: 5 }]) {
      const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
      const signature = createHmac('sha256', key).update(encoded).digest('base64url');
      expect(tokens.verify(`${encoded}.${signature}`)).toBeNull();
    }
  });
});

describe('the longest genuine token', () => {
  it('is far below the limit and still verifies', () => {
    const tokens = createCandidateTokens();
    const longest: CandidatePayload = {
      imageUrl: `https://upload.wikimedia.org/${'a'.repeat(2020)}`,
      creditText: 'c'.repeat(300),
      creditUrl: `https://commons.wikimedia.org/${'b'.repeat(2020)}`,
    };
    const token = tokens.sign(longest);
    expect(token.length).toBeGreaterThan(4096);
    expect(token.length).toBeLessThanOrEqual(MAX_TOKEN_LENGTH);
    expect(tokens.verify(token)).toEqual(longest);
  });
});
