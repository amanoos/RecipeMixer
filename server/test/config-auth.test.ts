import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { makeTempDir } from './helpers.js';

const STRONG = 'correct-horse-battery-staple';

function passwordFile(contents: string): string {
  const file = path.join(makeTempDir('recipemixer-secret-'), 'password');
  fs.writeFileSync(file, contents);
  return file;
}

describe('the startup guard with a password', () => {
  it('runs on loopback without a password, as before', () => {
    const config = loadConfig({});
    expect(config.appPassword).toBeNull();
    expect(config.host).toBe('127.0.0.1');
  });

  it('keeps a strong password in the settings', () => {
    expect(loadConfig({ APP_PASSWORD: STRONG }).appPassword).toBe(STRONG);
  });

  it('lets a non-loopback host start when a strong password is set, with no opt-in needed', () => {
    const config = loadConfig({ HOST: '0.0.0.0', APP_PASSWORD: STRONG });
    expect(config.host).toBe('0.0.0.0');
    expect(config.allowInsecureNoAuth).toBe(false);
    expect(config.appPassword).toBe(STRONG);
  });

  it('still refuses a non-loopback host with neither a password nor the opt-in, and says how to fix it', () => {
    expect(() => loadConfig({ HOST: '0.0.0.0' })).toThrow(/APP_PASSWORD/);
    expect(() => loadConfig({ HOST: '0.0.0.0' })).toThrow(/randomBytes/);
  });

  it('keeps the explicit opt-in working without a password', () => {
    const config = loadConfig({ HOST: '0.0.0.0', ALLOW_INSECURE_NO_AUTH: 'true' });
    expect(config.appPassword).toBeNull();
  });

  it('enforces the password when it is set together with the opt-in', () => {
    const config = loadConfig({ HOST: '0.0.0.0', ALLOW_INSECURE_NO_AUTH: 'true', APP_PASSWORD: STRONG });
    expect(config.appPassword).toBe(STRONG);
  });
});

describe('the app password', () => {
  it.each(['short', 'aaaaaaaaaaaaaaaa', 'Password-2026!', 'recipemixer-1', 'changeme12345', '            '])(
    'refuses the weak password %j, and the message never repeats it',
    (weak) => {
      let message = '';
      try {
        loadConfig({ APP_PASSWORD: weak });
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toMatch(/app password/);
      expect(message).toContain('randomBytes');
      if (weak.trim()) expect(message).not.toContain(weak);
    },
  );

  it('accepts a long passphrase that merely contains a common word', () => {
    expect(() => loadConfig({ APP_PASSWORD: 'my secret recipe book of soups' })).not.toThrow();
  });

  it('refuses an empty password instead of silently running without one', () => {
    expect(() => loadConfig({ APP_PASSWORD: '' })).toThrow(/empty/);
    expect(() => loadConfig({ HOST: '0.0.0.0', APP_PASSWORD: '' })).toThrow(/empty/);
  });

  it('refuses a password that is too long', () => {
    expect(() => loadConfig({ APP_PASSWORD: `${STRONG}-`.repeat(20) })).toThrow(/at most 200/);
  });
});

describe('the password file', () => {
  it('reads the password from the file and drops the trailing newline', () => {
    expect(loadConfig({ APP_PASSWORD_FILE: passwordFile(`${STRONG}\n`) }).appPassword).toBe(STRONG);
    expect(loadConfig({ APP_PASSWORD_FILE: passwordFile(`${STRONG}\r\n`) }).appPassword).toBe(STRONG);
  });

  it('lets a non-loopback host start with a password file', () => {
    expect(() => loadConfig({ HOST: '0.0.0.0', APP_PASSWORD_FILE: passwordFile(STRONG) })).not.toThrow();
  });

  it('refuses both settings at once', () => {
    expect(() => loadConfig({ APP_PASSWORD: STRONG, APP_PASSWORD_FILE: passwordFile(STRONG) })).toThrow(/not both/);
  });

  it('refuses a missing, empty or weak file, and never prints the file contents', () => {
    expect(() => loadConfig({ APP_PASSWORD_FILE: path.join(makeTempDir(), 'nope') })).toThrow(/Could not read APP_PASSWORD_FILE \(ENOENT\)/);
    expect(() => loadConfig({ APP_PASSWORD_FILE: passwordFile('') })).toThrow(/empty/);
    expect(() => loadConfig({ APP_PASSWORD_FILE: '' })).toThrow(/empty/);
    let message = '';
    try {
      loadConfig({ APP_PASSWORD_FILE: passwordFile('hunter2-wk') });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/at least 12/);
    expect(message).not.toContain('hunter2');
  });
});

describe('TRUST_PROXY', () => {
  it('trusts no proxy by default', () => {
    expect(loadConfig({}).trustProxy).toBe(false);
    expect(loadConfig({ TRUST_PROXY: 'false' }).trustProxy).toBe(false);
    expect(loadConfig({ TRUST_PROXY: '' }).trustProxy).toBe(false);
  });

  it('takes the proxy addresses, as IPs, ranges or keywords', () => {
    expect(loadConfig({ TRUST_PROXY: '172.30.0.0/24' }).trustProxy).toEqual(['172.30.0.0/24']);
    expect(loadConfig({ TRUST_PROXY: 'loopback' }).trustProxy).toEqual(['loopback']);
    expect(loadConfig({ TRUST_PROXY: ' 10.0.0.1, fd00::/8 ' }).trustProxy).toEqual(['10.0.0.1', 'fd00::/8']);
  });

  it.each(['true', '1', '3', 'abc', '10.0.0.0/33', '::1/129', '1.2.3.4/', '1.2.3.4/5/6', '*', '10.0.0.1,,bad'])(
    'refuses %j',
    (value) => {
      expect(() => loadConfig({ TRUST_PROXY: value })).toThrow(/TRUST_PROXY/);
    },
  );
});

describe('COOKIE_SECURE and ALLOWED_HOSTS', () => {
  it('decides the Secure flag automatically unless forced', () => {
    expect(loadConfig({}).cookieSecure).toBe('auto');
    expect(loadConfig({ COOKIE_SECURE: 'auto' }).cookieSecure).toBe('auto');
    expect(loadConfig({ COOKIE_SECURE: 'true' }).cookieSecure).toBe('always');
    expect(() => loadConfig({ COOKIE_SECURE: 'yes' })).toThrow(/COOKIE_SECURE/);
  });

  it('lists extra allowed host names, lower-cased', () => {
    expect(loadConfig({}).allowedHosts).toEqual([]);
    expect(loadConfig({ ALLOWED_HOSTS: 'Pi.local, 192.168.1.5' }).allowedHosts).toEqual(['pi.local', '192.168.1.5']);
  });

  it.each(['a b', 'host:3000', 'http://x', '*', '/path', 'exa$mple'])('refuses the host list %j', (value) => {
    expect(() => loadConfig({ ALLOWED_HOSTS: value })).toThrow(/ALLOWED_HOSTS/);
  });
});
