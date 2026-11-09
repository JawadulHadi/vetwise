import { randomUUID } from 'node:crypto';
import { now } from '../clock.js';
import type { Database } from './types.js';
import { hashToken, newId, type Store } from '../store/store.js';

/**
 * Two-phase confirmation for anything that changes the household record.
 *
 * `propose_record_change` mints a single-use token bound to the caller and the
 * exact action. `apply_record_change` must present that token. The token is
 * marked used only after the mutation succeeds, so a failed apply does not burn
 * the caregiver's confirmation.
 */
export class ConfirmationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfirmationError';
  }
}

export interface MintOptions {
  action: string;
  payload: unknown;
  clientId: string;
  ttlMinutes?: number;
}

export async function mintConfirmation(store: Store, options: MintOptions): Promise<{ token: string; expiresAt: string }> {
  const token = `vw_${randomUUID().replaceAll('-', '')}`;
  // Wall time, not the demo clock: a frozen DEMO_CLOCK must never stop a
  // confirmation from expiring.
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + (options.ttlMinutes ?? 10) * 60_000).toISOString();

  await store.mutate((db) => {
    const cutoff = createdAt.getTime();
    db.confirmations = db.confirmations.filter((entry) => new Date(entry.expiresAt).getTime() > cutoff);
    db.confirmations.push({
      tokenHash: hashToken(token),
      action: options.action,
      payload: options.payload,
      clientId: options.clientId,
      createdAt: createdAt.toISOString(),
      expiresAt,
    });
  });

  return { token, expiresAt };
}

export interface ApplyOptions<T> {
  actions: string[];
  clientId: string;
  apply: (db: Database, payload: unknown, action: string) => T;
}

/**
 * Validate, apply, then mark used — all inside one serialised store mutation.
 * If `apply` throws, the in-memory database is restored from a snapshot and the
 * token stays usable.
 */
export async function applyConfirmation<T>(store: Store, token: string, options: ApplyOptions<T>): Promise<T> {
  return store.mutate((db) => {
    const hash = hashToken(token.trim());
    const record = db.confirmations.find((entry) => entry.tokenHash === hash);
    if (!record) throw new ConfirmationError('That confirmation code is not recognised. Ask me to prepare the change again.');
    if (record.usedAt) throw new ConfirmationError('That confirmation code was already used. Ask me to prepare the change again.');
    if (!options.actions.includes(record.action)) {
      throw new ConfirmationError('That confirmation code belongs to a different action.');
    }
    if (record.clientId !== options.clientId) {
      throw new ConfirmationError('That confirmation code belongs to a different caregiver.');
    }
    if (new Date(record.expiresAt).getTime() < Date.now()) {
      throw new ConfirmationError('That confirmation code has expired. Ask me to prepare the change again.');
    }

    const snapshot = structuredClone(db);
    try {
      const result = options.apply(db, record.payload, record.action);
      record.usedAt = now().toISOString();
      return result;
    } catch (error) {
      // No half-applied record changes: restore every nested object.
      Object.assign(db, snapshot);
      throw error;
    }
  });
}

export function audit(db: Database, actor: string, action: string, detail?: string): void {
  db.audit.unshift({
    id: newId('audit'),
    at: now().toISOString(),
    actor,
    action,
    ...(detail ? { detail } : {}),
  });
}
