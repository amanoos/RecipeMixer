import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isLoopbackHost, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('uses safe loopback defaults', () => {
    const config = loadConfig({});
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(3210);
    expect(config.dataDir).toBe(path.resolve('./data'));
    expect(config.logLevel).toBe('info');
    expect(config.allowInsecureNoAuth).toBe(false);
    expect(config.isProduction).toBe(false);
  });

  it('refuses a non-loopback host without the explicit opt-in', () => {
    expect(() => loadConfig({ HOST: '0.0.0.0' })).toThrow(/Refusing to bind/);
  });

  it('does not treat a password setting as authentication yet', () => {
    expect(() => loadConfig({ HOST: '0.0.0.0', APP_PASSWORD: 'x' })).toThrow(/Refusing to bind/);
  });

  it('accepts a non-loopback host with ALLOW_INSECURE_NO_AUTH=true', () => {
    const config = loadConfig({ HOST: '0.0.0.0', ALLOW_INSECURE_NO_AUTH: 'true' });
    expect(config.host).toBe('0.0.0.0');
    expect(config.allowInsecureNoAuth).toBe(true);
  });

  it.each(['abc', '0', '70000', '-1', ''])('rejects invalid PORT %j', (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(/Invalid configuration/);
  });

  it('rejects an unknown log level', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'loud' })).toThrow(/Invalid configuration/);
  });

  it('detects production', () => {
    expect(loadConfig({ NODE_ENV: 'production' }).isProduction).toBe(true);
  });
});

describe('isLoopbackHost', () => {
  it.each(['127.0.0.1', '127.0.0.2', '::1', 'localhost', 'LOCALHOST'])('accepts %s', (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each(['0.0.0.0', '::', '192.168.1.5', '127.evil.example.com', '10.0.0.1'])('rejects %s', (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});
