import { describe, expect, it } from 'vitest';
import { isPublicAddress } from '../src/services/ip-guard.js';

describe('isPublicAddress', () => {
  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '172.15.255.255',
    '172.32.0.0',
    '100.63.255.255',
    '100.128.0.0',
    '2606:4700:4700::1111',
    '2a00:1450:4001:81b::200e',
  ])('allows the public address %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each([
    '0.0.0.0',
    '0.255.255.255',
    '10.0.0.1',
    '10.255.255.255',
    '100.64.0.1',
    '100.127.255.255',
    '127.0.0.1',
    '127.255.255.254',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.1',
    '192.0.2.5',
    '192.88.99.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.19.255.255',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '239.255.255.255',
    '240.0.0.1',
    '255.255.255.255',
  ])('blocks the IPv4 address %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each([
    '::',
    '::1',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    'ff02::1',
    '64:ff9b::808:808',
    '100::1',
    '2001::1',
    '2001:db8::1',
    '2002:7f00:1::1',
    '2002:a00:1::',
    '3fff::1',
  ])('blocks the IPv6 address %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it('unwraps IPv4-mapped IPv6 addresses and applies the IPv4 rules', () => {
    expect(isPublicAddress('::ffff:127.0.0.1')).toBe(false);
    expect(isPublicAddress('::ffff:7f00:1')).toBe(false);
    expect(isPublicAddress('::ffff:10.1.2.3')).toBe(false);
    expect(isPublicAddress('::ffff:a9fe:a9fe')).toBe(false);
    expect(isPublicAddress('0:0:0:0:0:ffff:192.168.0.1')).toBe(false);
    expect(isPublicAddress('::ffff:8.8.8.8')).toBe(true);
    expect(isPublicAddress('::ffff:808:808')).toBe(true);
  });

  it.each(['', 'localhost', 'example.com', '999.1.1.1', '1.2.3', '1.2.3.4.5', '127.1', '2130706433', '0x7f.0.0.1', '[::1]', 'not an ip'])(
    'fails closed on %j',
    (value) => {
      expect(isPublicAddress(value)).toBe(false);
    },
  );
});
