import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Rules and checks for the single shared app password (APP_PASSWORD / APP_PASSWORD_FILE).
 * The password lives only in the environment: it is never written to the database or the logs.
 */

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

/** A command that prints a strong random password. */
export const GENERATE_PASSWORD_HINT = `node -e "console.log(require('node:crypto').randomBytes(18).toString('base64url'))"`;

// Obvious choices that a guesser tries first, compared on letters only so "Password-2026!" is caught too.
const COMMON_WORDS = [
  'password',
  'passw0rd',
  'changeme',
  'recipemixer',
  'letmein',
  'qwerty',
  'welcome',
  'iloveyou',
  'secret',
  'admin',
];

// Rows of a keyboard: a password typed along one is as easy to guess as the alphabet.
const KEYBOARD_RUNS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890', 'qazwsxedc'];
const RUN_LENGTH = 4;

/** True when one short block is simply repeated ("abcabcabcabc"). */
function repeatsABlock(password: string): boolean {
  for (let size = 1; size <= password.length / 2; size++) {
    if (password.length % size === 0 && password === password.slice(0, size).repeat(password.length / size)) return true;
  }
  return false;
}

/** The share of characters that sit in a run of 4 or more steps along the alphabet, the digits or a keyboard row. */
function sequenceShare(password: string): number {
  const text = password.toLowerCase();
  const covered = new Array<boolean>(text.length).fill(false);

  for (const step of [1, -1]) {
    let start = 0;
    for (let i = 1; i <= text.length; i++) {
      const continues = i < text.length && text.charCodeAt(i) - text.charCodeAt(i - 1) === step;
      if (continues) continue;
      if (i - start >= RUN_LENGTH) covered.fill(true, start, i);
      start = i;
    }
  }

  for (const row of KEYBOARD_RUNS) {
    for (const line of [row, [...row].reverse().join('')]) {
      for (let i = 0; i + RUN_LENGTH <= text.length; i++) {
        if (line.includes(text.slice(i, i + RUN_LENGTH))) covered.fill(true, i, i + RUN_LENGTH);
      }
    }
  }
  return covered.filter(Boolean).length / text.length;
}

/** Returns why a password is too weak, or null when it is acceptable. The reason never contains the password. */
export function checkPasswordStrength(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `must be at least ${MIN_PASSWORD_LENGTH} characters long`;
  if (password.length > MAX_PASSWORD_LENGTH) return `must be at most ${MAX_PASSWORD_LENGTH} characters long`;
  if (new Set(password).size < 5) return 'uses too few different characters';
  if (/^\d+$/.test(password)) return 'is only digits';
  if (repeatsABlock(password)) return 'repeats a short pattern';
  if (sequenceShare(password) >= 0.6) return 'is mostly a simple sequence';

  const letters = password.toLowerCase().replace(/[^a-z]/g, '');
  for (const word of COMMON_WORDS) {
    // A common word with only a few extra letters around it ("changeme-please") is still easy to guess; a long passphrase is fine.
    if (letters.includes(word) && letters.length - word.length <= 6) return 'is too easy to guess';
  }
  return null;
}

const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/** Constant-time comparison: both sides are hashed first, so timing reveals neither the length nor the content. */
export function passwordMatches(configured: string, candidate: string): boolean {
  return timingSafeEqual(digest(configured), digest(candidate));
}

/** The key that ties login sessions to the current password: a new password means a new key, so old sessions stop working. */
export function sessionKeyFor(password: string): Buffer {
  return createHash('sha256').update('recipemixer-session-key-v1\0').update(password, 'utf8').digest();
}
