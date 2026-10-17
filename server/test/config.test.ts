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

  it('does not let a weak password open up a non-loopback host', () => {
    expect(() => loadConfig({ HOST: '0.0.0.0', APP_PASSWORD: 'x' })).toThrow(/at least 12 characters/);
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

describe('URL import switch', () => {
  it('is on by default and can be turned off', () => {
    expect(loadConfig({}).urlImportEnabled).toBe(true);
    expect(loadConfig({ URL_IMPORT_ENABLED: 'false' }).urlImportEnabled).toBe(false);
  });

  it('rejects other values', () => {
    expect(() => loadConfig({ URL_IMPORT_ENABLED: 'maybe' })).toThrow(/URL_IMPORT_ENABLED/);
  });
});

describe('TheMealDB settings', () => {
  it('is off by default and uses the development key', () => {
    const config = loadConfig({});
    expect(config.mealdbEnabled).toBe(false);
    expect(config.mealdbApiKey).toBe('1');
  });

  it('can be turned on with a key of plain characters', () => {
    const config = loadConfig({ MEALDB_ENABLED: 'true', MEALDB_API_KEY: ' abc_DEF-123 ' });
    expect(config.mealdbEnabled).toBe(true);
    expect(config.mealdbApiKey).toBe('abc_DEF-123');
  });

  it.each(['a/b', '../x', 'a b', 'key?x=1', 'a'.repeat(65), '', '%2e%2e'])('refuses the key %j without repeating it', (key) => {
    let message = '';
    try {
      loadConfig({ MEALDB_API_KEY: key });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/MEALDB_API_KEY/);
    if (key) expect(message).not.toContain(key);
  });

  it('rejects other values for the switch', () => {
    expect(() => loadConfig({ MEALDB_ENABLED: 'yes' })).toThrow(/MEALDB_ENABLED/);
  });
});
