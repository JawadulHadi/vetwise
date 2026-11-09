import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Database } from '../domain/types.js';
import { hashToken } from '../hash.js';
import { advanceEpoch, currentEpoch, requestStartEpoch, StaleDemoRequestError } from '../http/fence.js';

// Re-exported so existing importers keep one obvious entry point.
export { hashToken };

export function emptyDatabase(): Database {
  return {
    household: { id: 'hh-vetwise', name: 'Vetwise household', timezone: 'America/Los_Angeles', ownerId: 'maya', sitterIds: ['noah'] },
    people: [],
    pets: [],
    clinics: [],
    medications: [],
    careLogs: [],
    exposures: [],
    outbox: [],
    confirmations: [],
    audit: [],
  };
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/** Bounds on append-only collections, so a long-running household log cannot
 *  grow the JSON file (and every write) without limit. */
const MAX_AUDIT_ENTRIES = 1_000;
const MAX_OUTBOX_ITEMS = 100;

function capCollections(db: Database): void {
  if (db.audit.length > MAX_AUDIT_ENTRIES) db.audit.length = MAX_AUDIT_ENTRIES;
  if (db.outbox.length > MAX_OUTBOX_ITEMS) db.outbox.length = MAX_OUTBOX_ITEMS;
}

function looksLikeDatabase(value: unknown): value is Database {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Database>;
  return (
    typeof candidate.household === 'object' &&
    candidate.household !== null &&
    Array.isArray(candidate.people) &&
    Array.isArray(candidate.pets) &&
    Array.isArray(candidate.medications) &&
    Array.isArray(candidate.careLogs) &&
    Array.isArray(candidate.exposures) &&
    Array.isArray(candidate.outbox) &&
    Array.isArray(candidate.confirmations) &&
    Array.isArray(candidate.audit)
  );
}

/**
 * Tiny JSON-file store.
 *
 * Every mutation is serialised through one promise chain and persisted with a
 * write-then-rename, so concurrent MCP tool calls cannot interleave a read and
 * a write or leave a half-written file behind.
 *
 * A file that exists but cannot be parsed is an error, not an invitation to
 * reseed. Silently replacing a household record because of a transient read
 * failure is exactly the kind of data-loss bug this store avoids.
 */
export class Store {
  private queue: Promise<unknown> = Promise.resolve();
  private version = 0;

  private constructor(
    private readonly file: string,
    private state: Database,
  ) {}

  /**
   * Opens a JSON database, creating parent directories and seeding and saving a
   * new record only when the file is absent. Rejects unreadable, malformed, or
   * unexpected records rather than reseeding them. Directory creation, seeding,
   * and persistence errors propagate.
   */
  static async open(file: string, seed: (db: Database) => void | Promise<void>): Promise<Store> {
    await mkdir(path.dirname(file), { recursive: true });

    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw new Error(`Could not read ${file}: ${(error as Error).message}`);
      const state = emptyDatabase();
      await seed(state);
      const store = new Store(file, state);
      await store.persist(state);
      return store;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `The Vetwise data file at ${file} is not valid JSON (${(error as Error).message}). ` +
          'Refusing to overwrite it. Move it aside to reseed the demo, or restore it from a backup.',
      );
    }

    if (!looksLikeDatabase(parsed)) {
      throw new Error(
        `The Vetwise data file at ${file} does not have the expected shape. ` +
          'Refusing to overwrite it. Move it aside to reseed the demo, or restore it from a backup.',
      );
    }

    return new Store(file, parsed);
  }

  read<T>(reader: (db: Database) => T): T {
    return reader(this.state);
  }

  get revision(): number {
    return this.version;
  }

  /**
   * Serializes a mutation of the live record, caps bounded collections, and saves
   * before incrementing the revision and returning the mutator's result.
   * Rejects with StaleDemoRequestError if the request's epoch is stale when its
   * queued write starts. Mutator and persistence errors propagate; changes
   * already made in memory are not rolled back by this method.
   */
  mutate<T>(mutator: (db: Database) => T | Promise<T>): Promise<T> {
    // A write from a request that started before a public-demo reset must not
    // land in the reseeded household. Checked when the write runs, not when it
    // is queued, because a reset can be queued ahead of it.
    const startedIn = requestStartEpoch();
    return this.enqueue(async () => {
      if (startedIn !== undefined && startedIn !== currentEpoch()) throw new StaleDemoRequestError();
      const result = await mutator(this.state);
      capCollections(this.state);
      await this.persist(this.state);
      this.version += 1;
      return result;
    });
  }

  /**
   * Replaces the whole record with a freshly seeded one, through the same
   * serialised queue as every other write. The new record is saved to disk
   * before it replaces the live one, so a failed save leaves the running
   * household exactly as it was. Used by the public-demo reset.
   * A successful reset increments the revision and advances the request epoch.
   * Seeding and persistence errors reject the returned promise.
   */
  reset(seed: (db: Database) => void | Promise<void>): Promise<void> {
    return this.enqueue(async () => {
      const fresh = emptyDatabase();
      await seed(fresh);
      await this.persist(fresh);
      this.state = fresh;
      this.version += 1;
      advanceEpoch();
    });
  }

  /** Runs one job after every job already queued, keeping the chain alive on failure. */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Saves the supplied record by writing a temporary file and renaming it over
   *  the data file. Serialization and filesystem errors propagate. */
  private async persist(state: Database): Promise<void> {
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(temporary, this.file);
  }
}
