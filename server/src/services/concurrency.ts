import { tooManyRequests } from '../errors.js';

/** Runs `work`, or refuses straight away when `max` jobs are already running. */
export type Limiter = <T>(work: () => Promise<T>) => Promise<T>;

/** One shared cap for everything that makes the server fetch from the internet. */
export function createLimiter(max: number): Limiter {
  let running = 0;
  return async (work) => {
    if (running >= max) throw tooManyRequests('Another import is already running. Try again in a moment.');
    running += 1;
    try {
      return await work();
    } finally {
      running -= 1;
    }
  };
}
