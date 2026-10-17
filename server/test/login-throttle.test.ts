import { beforeEach, describe, expect, it } from 'vitest';
import { LoginThrottle, throttleKey } from '../src/services/login-throttle.js';

const MINUTE = 60 * 1000;
let time: number;
let throttle: LoginThrottle;

beforeEach(() => {
  time = 1_000_000;
  throttle = new LoginThrottle({ now: () => time });
});

const failTimes = (address: string, count: number) => {
  for (let i = 0; i < count; i++) throttle.fail(address);
};

describe('LoginThrottle', () => {
  it('lets an address try again after a few wrong passwords', () => {
    failTimes('1.2.3.4', 4);
    expect(throttle.check('1.2.3.4')).toEqual({ locked: false, retryAfterSeconds: 0, delayMs: 0 });
  });

  it('locks an address on the fifth wrong password, and says for how long', () => {
    failTimes('1.2.3.4', 5);
    expect(throttle.check('1.2.3.4')).toEqual({ locked: true, retryAfterSeconds: 15 * 60, delayMs: 0 });
    time += 5 * MINUTE;
    expect(throttle.check('1.2.3.4')).toEqual({ locked: true, retryAfterSeconds: 10 * 60, delayMs: 0 });
  });

  it('unlocks exactly when the lock runs out', () => {
    failTimes('1.2.3.4', 5);
    time += 15 * MINUTE - 1;
    expect(throttle.check('1.2.3.4').locked).toBe(true);
    time += 1;
    expect(throttle.check('1.2.3.4').locked).toBe(false);
  });

  it('starts counting again after a lock has ended', () => {
    failTimes('1.2.3.4', 5);
    time += 15 * MINUTE;
    failTimes('1.2.3.4', 4);
    expect(throttle.check('1.2.3.4').locked).toBe(false);
    throttle.fail('1.2.3.4');
    expect(throttle.check('1.2.3.4').locked).toBe(true);
  });

  it('only counts failures inside the 15-minute window', () => {
    failTimes('1.2.3.4', 3);
    time += 16 * MINUTE;
    failTimes('1.2.3.4', 4);
    expect(throttle.check('1.2.3.4').locked).toBe(false);
  });

  it('locks only the address that failed, so a stranger cannot lock the owner out', () => {
    failTimes('6.6.6.6', 50);
    expect(throttle.check('6.6.6.6').locked).toBe(true);
    expect(throttle.check('203.0.113.7').locked).toBe(false);
  });

  it('forgets an address after a correct password', () => {
    failTimes('1.2.3.4', 4);
    throttle.succeed('1.2.3.4');
    failTimes('1.2.3.4', 4);
    expect(throttle.check('1.2.3.4').locked).toBe(false);
  });

  it('does not extend a lock by more wrong passwords sent while locked', () => {
    failTimes('1.2.3.4', 5);
    time += 10 * MINUTE;
    // the route refuses locked addresses before checking the password, so nothing more is recorded
    expect(throttle.check('1.2.3.4').retryAfterSeconds).toBe(5 * 60);
  });

  it('keeps its memory bounded when many addresses fail', () => {
    for (let i = 0; i < 6000; i++) throttle.fail(`10.${i >> 8}.${i & 255}.1`);
    // the oldest records were dropped; the newest are still tracked and the process is still fine
    failTimes('10.255.255.1', 5);
    expect(throttle.check('10.255.255.1').locked).toBe(true);
  });

  it('honours custom limits', () => {
    const strict = new LoginThrottle({ maxFailures: 2, lockMs: MINUTE, windowMs: MINUTE, now: () => time });
    strict.fail('a');
    strict.fail('a');
    expect(strict.check('a')).toEqual({ locked: true, retryAfterSeconds: 60, delayMs: 0 });
  });
});

describe('the slow-down after many wrong passwords from anywhere', () => {
  it('holds every attempt back once enough wrong passwords have come in, without locking anyone', () => {
    for (let i = 0; i < 49; i++) throttle.fail(`10.0.${i >> 8}.${i & 255}`);
    expect(throttle.check('203.0.113.9')).toEqual({ locked: false, retryAfterSeconds: 0, delayMs: 0 });

    throttle.fail('10.9.9.9');
    // the owner, who has never failed, is not locked, only asked to wait a moment
    expect(throttle.check('203.0.113.9')).toEqual({ locked: false, retryAfterSeconds: 0, delayMs: 1000 });
  });

  it('ends when the bad attempts are older than the window', () => {
    for (let i = 0; i < 60; i++) throttle.fail(`10.0.0.${i}`);
    expect(throttle.check('203.0.113.9').delayMs).toBe(1000);
    time += 15 * MINUTE;
    expect(throttle.check('203.0.113.9').delayMs).toBe(0);
  });

  it('honours its own limits and keeps only a bounded history', () => {
    const quick = new LoginThrottle({ globalSlowdownAfter: 3, slowdownMs: 250, now: () => time });
    for (let i = 0; i < 1000; i++) quick.fail(`10.0.${i >> 8}.${i & 255}`);
    expect(quick.check('x').delayMs).toBe(250);
  });
});

describe('throttleKey', () => {
  it('counts an IPv4 address as itself', () => {
    expect(throttleKey('203.0.113.9')).toBe('203.0.113.9');
  });

  it('counts every address in one IPv6 /64 as one client', () => {
    const key = throttleKey('2001:db8:1234:5678:aaaa:bbbb:cccc:dddd');
    expect(key).toBe('2001:0db8:1234:5678::/64');
    expect(throttleKey('2001:db8:1234:5678::1')).toBe(key);
    expect(throttleKey('2001:DB8:1234:5678:ffff:ffff:ffff:ffff')).toBe(key);
    expect(throttleKey('2001:db8:1234:5679::1')).not.toBe(key);
    expect(throttleKey('2001:db8:1234:5678:0:0:0:1')).toBe(key);
  });

  it('handles compressed and unusual IPv6 forms', () => {
    expect(throttleKey('::1')).toBe('0000:0000:0000:0000::/64');
    expect(throttleKey('fe80::1%eth0')).toBe('fe80:0000:0000:0000::/64');
    expect(throttleKey('2001:db8::')).toBe('2001:0db8:0000:0000::/64');
  });

  it('counts an IPv4-mapped IPv6 address as the IPv4 address it wraps, in either spelling', () => {
    expect(throttleKey('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(throttleKey('::ffff:cb00:7109')).toBe('203.0.113.9');
    expect(throttleKey('0:0:0:0:0:ffff:cb00:7109')).toBe('203.0.113.9');
  });

  it('leaves something that is not an address alone', () => {
    expect(throttleKey('not-an-address')).toBe('not-an-address');
    expect(throttleKey('')).toBe('');
  });
});
