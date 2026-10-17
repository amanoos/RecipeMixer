import { beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDatabase, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { createSessionStore, SESSION_ABSOLUTE_MS, SESSION_IDLE_MS, type SessionStore } from '../src/db/sessions.js';
import { sessionKeyFor } from '../src/services/password.js';

const DAY = 24 * 60 * 60 * 1000;
const KEY = sessionKeyFor('correct-horse-battery-staple');

let db: Db;
let time: number;
let store: SessionStore;

beforeEach(() => {
  db = openMemoryDatabase();
  migrate(db);
  time = 1_800_000_000_000;
  store = createSessionStore(db, KEY, () => time);
});

const rows = () => db.prepare('SELECT * FROM session').all() as { id: string; created_at: number; last_seen_at: number }[];

describe('creating and finding sessions', () => {
  it('gives a long random token that finds its session', () => {
    const token = store.create();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.find(token)).toBe(true);
  });

  it('gives a different token every time', () => {
    expect(new Set(Array.from({ length: 50 }, () => store.create())).size).toBe(50);
  });

  it('does not find an unknown, empty, missing or oversized token', () => {
    store.create();
    expect(store.find('not-a-real-token')).toBe(false);
    expect(store.find('')).toBe(false);
    expect(store.find(undefined)).toBe(false);
    expect(store.find('x'.repeat(5000))).toBe(false);
  });

  it('stores only a keyed hash, from which the token cannot be recovered', () => {
    const token = store.create();
    const [row] = rows();
    expect(rows()).toHaveLength(1);
    expect(row!.id).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it('does not find a token under a different password key, so a new password ends every session', () => {
    const token = store.create();
    const afterPasswordChange = createSessionStore(db, sessionKeyFor('a-completely-new-password'), () => time);
    expect(store.find(token)).toBe(true);
    expect(afterPasswordChange.find(token)).toBe(false);
  });
});

describe('expiry', () => {
  it('ends a session after 7 days without use, exactly at the limit', () => {
    const token = store.create();
    time += SESSION_IDLE_MS;
    expect(store.find(token)).toBe(true);
    time += SESSION_IDLE_MS + 1; // the check above moved last use forward
    expect(store.find(token)).toBe(false);
  });

  it('keeps a session alive while it is used, but never beyond 30 days in total', () => {
    const token = store.create();
    for (let day = 1; day <= 30; day++) {
      time += DAY;
      expect(store.find(token)).toBe(true);
    }
    time += 1;
    expect(store.find(token)).toBe(false);
  });

  it('ends a session once it is 30 days old even if it was used a moment ago', () => {
    const start = time;
    const token = store.create();
    for (let day = 1; day <= 29; day++) {
      time += DAY;
      expect(store.find(token)).toBe(true);
    }
    time = start + SESSION_ABSOLUTE_MS - 1000;
    expect(store.find(token)).toBe(true);
    time = start + SESSION_ABSOLUTE_MS + 1000;
    expect(store.find(token)).toBe(false);
  });

  it('deletes an expired session when it is found, so it cannot come back', () => {
    const token = store.create();
    time += 8 * DAY;
    expect(store.find(token)).toBe(false);
    expect(rows()).toHaveLength(0);
    time -= 8 * DAY;
    expect(store.find(token)).toBe(false);
  });

  it('records use at most once a minute', () => {
    const token = store.create();
    const created = time;
    time += 30_000;
    store.find(token);
    expect(rows()[0]!.last_seen_at).toBe(created);
    time += 31_000;
    store.find(token);
    expect(rows()[0]!.last_seen_at).toBe(time);
  });

  it('is not confused by the clock moving backwards', () => {
    const token = store.create();
    time -= DAY;
    expect(store.find(token)).toBe(true);
  });
});

describe('revoking and purging', () => {
  it('ends only the session that was revoked', () => {
    const first = store.create();
    const second = store.create();
    store.revoke(first);
    expect(store.find(first)).toBe(false);
    expect(store.find(second)).toBe(true);
  });

  it('ignores an unknown or missing token', () => {
    const token = store.create();
    expect(() => {
      store.revoke('nope');
      store.revoke(undefined);
      store.revoke('x'.repeat(5000));
    }).not.toThrow();
    expect(store.find(token)).toBe(true);
  });

  it('purges expired sessions and keeps live ones', () => {
    const old = store.create();
    time += 25 * DAY;
    const recent = store.create();
    time += 4 * DAY; // old has been idle for 29 days, recent for 4
    expect(store.purgeExpired()).toBe(1);
    expect(store.find(old)).toBe(false);
    expect(store.find(recent)).toBe(true);
  });

  it('purges sessions older than 30 days even if recently used', () => {
    store.create();
    time += 29 * DAY;
    store.create();
    time += 2 * DAY;
    expect(store.purgeExpired()).toBe(1);
    expect(rows()).toHaveLength(1);
  });
});
