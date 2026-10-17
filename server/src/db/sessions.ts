import { createHmac, randomBytes } from 'node:crypto';
import type { Db } from './connection.js';

/** A session ends after 7 days without use, or 30 days after it began, whichever comes first. */
export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
/** Use is recorded at most this often, so browsing does not write to the database on every request. */
const TOUCH_INTERVAL_MS = 60 * 1000;
const MAX_TOKEN_LENGTH = 128;

export interface SessionStore {
  /** Starts a session and returns the secret token for the cookie. Only a keyed hash of it is stored. */
  create(): string;
  /** True when the token belongs to a live session. Expired sessions are deleted as they are found. */
  find(token: string | undefined): boolean;
  /** Ends the session this token belongs to (a no-op for an unknown token). */
  revoke(token: string | undefined): void;
  /** Deletes every session that has expired and returns how many were removed. */
  purgeExpired(): number;
}

/**
 * Login sessions kept in SQLite. The row id is HMAC(key, token), where the key comes from the app password:
 * the table cannot be turned back into a working cookie, and a new password makes every old session unusable.
 */
export function createSessionStore(db: Db, key: Buffer, now: () => number = Date.now): SessionStore {
  const idOf = (token: string): string => createHmac('sha256', key).update(token).digest('hex');

  const insert = db.prepare('INSERT INTO session (id, created_at, last_seen_at) VALUES (?, ?, ?)');
  const select = db.prepare('SELECT created_at, last_seen_at FROM session WHERE id = ?');
  const touch = db.prepare('UPDATE session SET last_seen_at = ? WHERE id = ?');
  const remove = db.prepare('DELETE FROM session WHERE id = ?');
  const purge = db.prepare('DELETE FROM session WHERE created_at < ? OR last_seen_at < ?');

  return {
    create() {
      const token = randomBytes(32).toString('base64url');
      const time = now();
      insert.run(idOf(token), time, time);
      return token;
    },

    find(token) {
      if (!token || token.length > MAX_TOKEN_LENGTH) return false;
      const id = idOf(token);
      const row = select.get(id) as { created_at: number; last_seen_at: number } | undefined;
      if (!row) return false;

      const time = now();
      if (time - row.created_at > SESSION_ABSOLUTE_MS || time - row.last_seen_at > SESSION_IDLE_MS) {
        remove.run(id);
        return false;
      }
      if (time - row.last_seen_at >= TOUCH_INTERVAL_MS) touch.run(time, id);
      return true;
    },

    revoke(token) {
      if (token && token.length <= MAX_TOKEN_LENGTH) remove.run(idOf(token));
    },

    purgeExpired() {
      const time = now();
      return purge.run(time - SESSION_ABSOLUTE_MS, time - SESSION_IDLE_MS).changes;
    },
  };
}
