import { now, todayKey } from '../clock.js';
import { config } from '../config.js';
import { careSummary, listMedications } from '../domain/care.js';
import type { Store } from '../store/store.js';

/** Structural subset of the SDK's `ServerContext` we rely on. */
export interface CallerContext {
  http?: { authInfo?: { token: string; clientId: string; scopes?: string[] } };
}

export const SCOPES = {
  read: 'vetwise.read',
  log: 'vetwise.log',
  write: 'vetwise.write',
  notify: 'vetwise.notify',
} as const;

export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeError';
  }
}

export interface Caller {
  clientId: string;
  scopes: string[];
  token: string;
}

export function callerFrom(ctx: CallerContext): Caller | undefined {
  const auth = ctx.http?.authInfo;
  if (!auth) return undefined;
  return { clientId: auth.clientId, scopes: auth.scopes ?? [], token: auth.token };
}

export function requireScope(ctx: CallerContext, scope: string): Caller {
  const caller = callerFrom(ctx);
  if (!caller) throw new ScopeError('No bearer token was presented. Send Authorization: Bearer <token>.');
  if (!caller.scopes.includes(scope)) {
    throw new ScopeError(`This token is missing the ${scope} scope. Ask Maya, the account owner, for access.`);
  }
  return caller;
}

export function callerLabel(clientId: string): string {
  return config.tokens.find((entry) => entry.clientId === clientId)?.label ?? clientId;
}

export function publishableState(store: Store) {
  return store.read((db) => {
    const day = todayKey();
    return {
      household: db.household,
      people: db.people.map(({ id, name, role, phone, notes }) => ({
        id,
        name,
        role,
        ...(phone ? { phone } : {}),
        ...(notes ? { notes } : {}),
      })),
      pets: db.pets,
      clinics: db.clinics,
      medications: listMedications(db, { status: 'all' }),
      care: careSummary(db, day),
      exposures: db.exposures.slice(0, 20),
      outbox: db.outbox.slice(0, 10),
      audit: db.audit.slice(0, 25),
      serverTime: now().toISOString(),
      demoTomorrow: false,
      tokens: config.tokens.map(({ token, ...rest }) => ({ ...rest, token: `${token.slice(0, 4)}…` })),
    };
  });
}
