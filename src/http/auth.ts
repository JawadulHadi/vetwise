import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config, type TokenRecord } from '../config.js';
import { hashBuffer } from '../hash.js';

/**
 * Express's `Request` already carries the MCP SDK's `AuthInfo` shape on
 * `req.auth`. We use that same slot so `toNodeHandler` can forward the caller
 * straight into the MCP server context.
 */
export type AuthedRequest = Request;

const digestCache = new Map<string, Buffer>();

function digest(token: string): Buffer {
  const cached = digestCache.get(token);
  if (cached) return cached;
  const value = hashBuffer(token);
  digestCache.set(token, value);
  return value;
}

function recordFor(presented: string): TokenRecord | undefined {
  const candidate = digest(presented);
  let match: TokenRecord | undefined;
  // Compare against every record without an early exit, so the loop takes the
  // same time whichever token was presented.
  for (const entry of config.tokens) {
    const stored = Buffer.from(entry.tokenHash, 'hex');
    if (stored.length === candidate.length && timingSafeEqual(stored, candidate)) match = entry;
  }
  return match;
}

export function tokenFromHeader(header: string | undefined): TokenRecord | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
  if (!match) return undefined;
  return recordFor(match[1]!.trim());
}

/**
 * The presented secret, for the one place that needs to use it: the chat
 * handler's internal MCP self-call. It is never copied onto `req.auth`.
 */
export function rawTokenFromHeader(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
  if (!match) return undefined;
  const presented = match[1]!.trim();
  return recordFor(presented) ? presented : undefined;
}

/** Bearer-token gate in front of the MCP endpoint. The MCP handler trusts us. */
export function bearerAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';

  if (!/^Bearer\s+(.+)$/i.test(header)) {
    res
      .status(401)
      .set('WWW-Authenticate', 'Bearer realm="vetwise"')
      .json({ error: 'invalid_token', error_description: 'A bearer token is required.' });
    return;
  }

  const record = tokenFromHeader(header);
  if (!record) {
    res
      .status(401)
      .set('WWW-Authenticate', 'Bearer realm="vetwise", error="invalid_token"')
      .json({ error: 'invalid_token', error_description: 'That token is not recognised.' });
    return;
  }

  // Only the identity and scopes travel with the request. The secret stays in
  // the Authorization header, which the tool layer never reads.
  req.auth = { token: record.tokenHint, clientId: record.clientId, scopes: [...record.scopes] };
  next();
}

/** Non-rejecting resolver for /api/whoami and the chat/state endpoints. */
export function resolveAuth(req: Request): Request['auth'] {
  const record = tokenFromHeader(req.headers.authorization);
  if (!record) return undefined;
  return { token: record.tokenHint, clientId: record.clientId, scopes: [...record.scopes] };
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  req.auth = resolveAuth(req);
  next();
}
