import net from 'node:net';

/** The IPv4 address inside an IPv4-mapped IPv6 address, or null. */
function mappedIPv4(groups: string[]): string | null {
  if (!groups.slice(0, 5).every((group) => group === '0000') || groups[5] !== 'ffff') return null;
  const high = Number.parseInt(groups[6] ?? '0', 16);
  const low = Number.parseInt(groups[7] ?? '0', 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

/** The eight four-digit groups of an IPv6 address, with "::" and a trailing IPv4 part expanded. */
function expandIPv6(address: string): string[] {
  let text = address.toLowerCase().split('%')[0] ?? '';
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (v4) {
    const hex = (value: number) => value.toString(16);
    text = text.replace(v4[0], `${hex((Number(v4[1]) << 8) | Number(v4[2]))}:${hex((Number(v4[3]) << 8) | Number(v4[4]))}`);
  }
  const compressed = text.includes('::');
  const [head = '', tail = ''] = text.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = compressed && tail ? tail.split(':') : [];
  const groups = compressed
    ? [...headGroups, ...new Array<string>(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill('0'), ...tailGroups]
    : headGroups;
  return groups.map((group) => group.padStart(4, '0'));
}

/**
 * The key the login limits count by. An IPv4 address counts as itself. Someone on IPv6 usually controls a whole
 * /64 range (billions of addresses), so every address in one counts as one client, and an IPv4-mapped IPv6 address
 * counts as the IPv4 address it wraps.
 */
export function throttleKey(address: string): string {
  if (net.isIP(address) !== 6) return address;
  const groups = expandIPv6(address);
  return mappedIPv4(groups) ?? `${groups.slice(0, 4).join(":")}::/64`;
}

/**
 * Slows down password guessing. After too many wrong passwords from one client address, that address
 * is locked out for a while. It counts per address (not for everyone together) so a stranger cannot lock
 * the owner out. State is in memory: it resets on restart, which is fine for a single-user app.
 */

export interface ThrottleOptions {
  /** Wrong passwords allowed inside the window before the address is locked. */
  maxFailures?: number;
  /** Wrong passwords from everyone together, inside the window, after which every attempt is made to wait. */
  globalSlowdownAfter?: number;
  /** How long each attempt waits while that slow-down is on. */
  slowdownMs?: number;
  windowMs?: number;
  lockMs?: number;
  now?: () => number;
}

export interface ThrottleStatus {
  locked: boolean;
  retryAfterSeconds: number;
  /** How long to hold an attempt back before checking it (0 when there is no slow-down). */
  delayMs: number;
}

interface Entry {
  failures: number[];
  lockedUntil: number;
}

const MAX_TRACKED_ADDRESSES = 5000;

export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();
  private readonly allFailures: number[] = [];
  private readonly maxFailures: number;
  private readonly globalSlowdownAfter: number;
  private readonly slowdownMs: number;
  private readonly windowMs: number;
  private readonly lockMs: number;
  private readonly now: () => number;

  constructor(options: ThrottleOptions = {}) {
    this.maxFailures = options.maxFailures ?? 5;
    this.globalSlowdownAfter = options.globalSlowdownAfter ?? 50;
    this.slowdownMs = options.slowdownMs ?? 1000;
    this.windowMs = options.windowMs ?? 15 * 60 * 1000;
    this.lockMs = options.lockMs ?? 15 * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  /** Whether this address may try a password right now. */
  check(address: string): ThrottleStatus {
    const entry = this.entries.get(address);
    const time = this.now();
    const delayMs = this.recentFailureCount(time) >= this.globalSlowdownAfter ? this.slowdownMs : 0;
    if (entry && entry.lockedUntil > time) {
      return { locked: true, retryAfterSeconds: Math.ceil((entry.lockedUntil - time) / 1000), delayMs };
    }
    return { locked: false, retryAfterSeconds: 0, delayMs };
  }

  /** Records a wrong password; the address is locked once it reaches the limit. */
  fail(address: string): void {
    const time = this.now();
    this.prune(time);
    this.allFailures.push(time);
    // enough history to know whether the slow-down is on, and no more
    if (this.allFailures.length > this.globalSlowdownAfter * 4) this.allFailures.splice(0, this.allFailures.length - this.globalSlowdownAfter * 4);

    const entry = this.entries.get(address) ?? { failures: [], lockedUntil: 0 };
    entry.failures = entry.failures.filter((at) => time - at < this.windowMs);
    entry.failures.push(time);
    if (entry.failures.length >= this.maxFailures) {
      entry.lockedUntil = time + this.lockMs;
      entry.failures = [];
    }
    this.entries.set(address, entry);
  }

  /** A correct password clears the address's record. */
  succeed(address: string): void {
    this.entries.delete(address);
  }

  private recentFailureCount(time: number): number {
    let count = 0;
    for (let i = this.allFailures.length - 1; i >= 0 && time - (this.allFailures[i] ?? 0) < this.windowMs; i--) count += 1;
    return count;
  }

  /** Forgets expired records, and the oldest ones if there are too many, so memory stays bounded. */
  private prune(time: number): void {
    if (this.entries.size < MAX_TRACKED_ADDRESSES) return;
    for (const [address, entry] of this.entries) {
      const stale = entry.lockedUntil <= time && entry.failures.every((at) => time - at >= this.windowMs);
      if (stale) this.entries.delete(address);
    }
    while (this.entries.size >= MAX_TRACKED_ADDRESSES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
