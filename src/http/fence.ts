import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

/**
 * Public-demo reset fence.
 *
 * Each reset advances the epoch. Every /mcp and /api/chat request is stamped
 * with the epoch it started in, and that stamp follows the request through its
 * async work. A write or a traffic entry from a request that started before the
 * latest reset is dropped, so nothing from before a reset can reappear in the
 * freshly seeded household. Outside a public demo the epoch never moves and the
 * fence never fires.
 */
let epoch = 0;
const requestEpoch = new AsyncLocalStorage<number>();

/** The chat route's self-call carries its own start epoch in this header. A
 *  caller can only use it to fence itself out, never to get past the fence. */
export const EPOCH_HEADER = 'x-vetwise-demo-epoch';

export class StaleDemoRequestError extends Error {
  constructor() {
    super('The public demo was reset while this request was running; nothing was saved. Please try again.');
    this.name = 'StaleDemoRequestError';
  }
}

export function currentEpoch(): number {
  return epoch;
}

/** Called by the reset, inside the store's write queue. */
export function advanceEpoch(): void {
  epoch += 1;
}

/** The epoch the running request started in, or undefined outside a request. */
export function requestStartEpoch(): number | undefined {
  return requestEpoch.getStore();
}

export function fenceRequest(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers[EPOCH_HEADER];
  const claimed = typeof header === 'string' ? Number(header) : Number.NaN;
  // Only an older epoch is honoured; a claimed future epoch is treated as current.
  const started = Number.isInteger(claimed) && claimed >= 0 && claimed < epoch ? claimed : epoch;
  requestEpoch.run(started, next);
}
