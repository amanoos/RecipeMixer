import { describe, expect, it } from 'vitest';
import { checkPasswordStrength, passwordMatches, sessionKeyFor } from '../src/services/password.js';

describe('checkPasswordStrength', () => {
  it.each(['correct-horse-battery-staple', 'xK9#mP2$vL7!qR4', 'my secret recipe book of soups', 'Tr0ub4dor&3-and-a-long-tail'])(
    'accepts %j',
    (password) => {
      expect(checkPasswordStrength(password)).toBeNull();
    },
  );

  it('refuses a short password', () => {
    expect(checkPasswordStrength('abc123XYZ!')).toMatch(/at least 12/);
    expect(checkPasswordStrength('')).toMatch(/at least 12/);
  });

  it('refuses a password that is far too long', () => {
    expect(checkPasswordStrength('a1b2c3d4e5f6'.repeat(20))).toMatch(/at most 200/);
  });

  it('refuses a password made of too few different characters', () => {
    expect(checkPasswordStrength('aaaaaaaaaaaaaaaa')).toMatch(/too few/);
    expect(checkPasswordStrength('abababababababab')).toMatch(/too few/);
  });

  it.each(['password1234', 'Password-2026!', 'recipemixer-2026', 'RECIPEMIXER!!!!!!', 'changeme-please', 'qwerty123456', 'welcome-home-1'])(
    'refuses the easy-to-guess %j',
    (password) => {
      // a few of these are also simple sequences, which is caught first; either way they are refused
      expect(checkPasswordStrength(password)).toMatch(/easy to guess|simple sequence/);
    },
  );

  it('refuses a random-looking string of digits too, because digits alone are easy to try', () => {
    expect(checkPasswordStrength('739184625017')).toMatch(/only digits/);
  });

  it.each(['123456789012', '000000000000', '98765432109876543210'])('refuses the digits-only %j', (password) => {
    expect(checkPasswordStrength(password)).toMatch(/only digits|few different|simple sequence|repeats/);
  });

  it.each([
    ['abcdefghijkl', /simple sequence/],
    ['zyxwvutsrqpo', /simple sequence/],
    ['1234567890ab', /simple sequence/],
    ['qwertyuiop12', /simple sequence/],
    ['asdfghjkl;12', /simple sequence/],
    ['mnopqrstuvwxyz1', /simple sequence/],
    ['abcdeabcdeab', /simple sequence|repeats/],
    ['xyzxyzxyzxyz', /few different|repeats|simple sequence/],
    ['12ab12ab12ab', /few different|repeats/],
    ['a1b2c3d4e5f6a1b2c3d4e5f6', /repeats/],
  ])('refuses the easy pattern %j', (password, reason) => {
    expect(checkPasswordStrength(password)).toMatch(reason);
  });

  it.each(['correct-horse-battery-staple', 'blue7-tractor-LEMON-9-window', 'Zq4!vT8#kW2$rN6', 'a-brand-new-password-2', 'browser-walk-test-password-91'])(
    'still accepts the good password %j',
    (password) => {
      expect(checkPasswordStrength(password)).toBeNull();
    },
  );

  it('does not refuse a long passphrase that only contains a common word', () => {
    expect(checkPasswordStrength('the admin of the kitchen likes soup')).toBeNull();
  });

  it('never repeats the password in its answer', () => {
    const answer = checkPasswordStrength('Password-2026!') ?? '';
    expect(answer).not.toContain('Password');
  });
});

describe('passwordMatches', () => {
  const secret = 'correct-horse-battery-staple';

  it('accepts the exact password and nothing else', () => {
    expect(passwordMatches(secret, secret)).toBe(true);
    expect(passwordMatches(secret, `${secret} `)).toBe(false);
    expect(passwordMatches(secret, secret.toUpperCase())).toBe(false);
    expect(passwordMatches(secret, secret.slice(0, -1))).toBe(false);
    expect(passwordMatches(secret, '')).toBe(false);
  });

  it('copes with candidates of any length or alphabet without throwing', () => {
    expect(passwordMatches(secret, 'x'.repeat(100_000))).toBe(false);
    expect(passwordMatches(secret, 'pässwörd-日本語-🍲')).toBe(false);
    expect(passwordMatches('pässwörd-日本語-🍲-long', 'pässwörd-日本語-🍲-long')).toBe(true);
  });
});

describe('sessionKeyFor', () => {
  it('is stable for one password and different for another, so a new password ends old sessions', () => {
    expect(sessionKeyFor('one-long-password-1').equals(sessionKeyFor('one-long-password-1'))).toBe(true);
    expect(sessionKeyFor('one-long-password-1').equals(sessionKeyFor('one-long-password-2'))).toBe(false);
    expect(sessionKeyFor('one-long-password-1')).toHaveLength(32);
  });
});
