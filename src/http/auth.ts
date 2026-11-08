import type { NextFunction, Request, Response } from 'express';
import { config, type TokenRecord } from '../config.js';

/**
 * Express's `Request` already carries the MCP SDK's `AuthInfo` shape on
 * `req.auth`. We use that same slot so `toNodeHandler` can forward the caller
 * straight into the MCP server context.
 */
export type AuthedRequest = Request;

export function tokenFromHeader(header: string | undefined): TokenRecord | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
  if (!match) return undefined;
  const presented = match[1]!.trim();
  return config.tokens.find((entry) => entry.token === presented);
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

  req.auth = { token: record.token, clientId: record.clientId, scopes: [...record.scopes] };
  next();
}

/** Non-rejecting resolver for /api/whoami and the chat/state endpoints. */
export function resolveAuth(req: Request): Request['auth'] {
  const record = tokenFromHeader(req.headers.authorization);
  if (!record) return undefined;
  return { token: record.token, clientId: record.clientId, scopes: [...record.scopes] };
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  req.auth = resolveAuth(req);
  next();
}
