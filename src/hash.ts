import { createHash } from 'node:crypto';

/**
 * One hashing helper for every secret this process compares.
 *
 * Bearer tokens and confirmation tokens are both stored as SHA-256 digests, so a
 * leaked data file never contains a usable credential, and comparisons can be
 * made in constant time over fixed-length buffers.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function hashBuffer(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}
