import type { Request, Response } from 'express';
import { agentMode, agentModel, runAgent } from '../agent/run.js';
import { withMcpClient } from '../agent/mcp.js';
import type { ScriptedContext, ScriptedState } from '../agent/scripted.js';
import { config } from '../config.js';
import { owner, petName } from '../domain/care.js';
import { publishableState } from '../mcp/auth.js';
import type { Store } from '../store/store.js';
import { listTraffic } from './traffic.js';
import { rawTokenFromHeader, tokenFromHeader } from './auth.js';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

interface Session {
  clientId: string;
  turns: ChatTurn[];
  scripted: ScriptedState;
  touchedAt: number;
}

const SESSION_TTL_MS = 30 * 60_000;
const MAX_SESSIONS = 200;

const sessions = new Map<string, Session>();

function sweep(nowMs: number): void {
  for (const [key, session] of sessions) {
    if (nowMs - session.touchedAt > SESSION_TTL_MS) sessions.delete(key);
  }
  // Map preserves insertion order, so the first key is the least recently
  // created session; dropping it keeps the store bounded under abuse.
  while (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
}

/**
 * Sessions are keyed by caller, not by the id the client sends. A client that
 * guesses another person's session id gets a fresh session of its own instead of
 * their transcript.
 */
function sessionFor(clientId: string, id: string): Session {
  const key = `${clientId}:${id}`;
  const nowMs = Date.now();
  const existing = sessions.get(key);
  if (existing && nowMs - existing.touchedAt <= SESSION_TTL_MS) {
    existing.touchedAt = nowMs;
    return existing;
  }
  if (existing) sessions.delete(key);
  sweep(nowMs);
  const created: Session = { clientId, turns: [], scripted: {}, touchedAt: nowMs };
  sessions.set(key, created);
  return created;
}

function contextFor(store: Store): ScriptedContext {
  return store.read((db) => {
    const primary = owner(db);
    const sitter = db.people.find((person) => person.role === 'sitter');
    const poisonControl = db.clinics.find((clinic) => clinic.kind === 'poison_control');
    return {
      ownerName: primary?.name ?? 'the owner',
      sitterName: sitter?.name ?? 'the sitter',
      people: db.people.map((person) => person.name),
      pets: db.pets.map((pet) => ({ name: pet.name, species: pet.species, weightKg: pet.weightKg, breed: pet.breed })),
      medications: db.medications.map((medication) => ({
        name: medication.name,
        petName: petName(db, medication.petId),
        times: medication.schedule.map((slot) => slot.time),
      })),
      ...(poisonControl ? { poisonControl: { name: poisonControl.name, phone: poisonControl.phone } } : {}),
    };
  });
}

export function chatHandler(store: Store) {
  return async (req: Request, res: Response): Promise<void> => {
    const record = tokenFromHeader(req.headers.authorization);
    const rawToken = rawTokenFromHeader(req.headers.authorization);
    if (!record || !rawToken) {
      res.status(401).json({ error: 'A bearer token is required.' });
      return;
    }

    const body = req.body as { sessionId?: string; message?: string } | undefined;
    const message = (body?.message ?? '').trim();
    if (!message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }
    if (message.length > 2_000) {
      res.status(413).json({ error: 'message is too long; keep it under 2000 characters.' });
      return;
    }

    const session = sessionFor(record.clientId, body?.sessionId?.slice(0, 64) || 'default');

    try {
      const result = await withMcpClient({ url: `${config.publicBaseUrl}/mcp`, token: rawToken }, (client) =>
        runAgent({
          client,
          message,
          history: session.turns.slice(-8),
          context: contextFor(store),
          scriptedState: session.scripted,
        }),
      );

      session.turns.push({ role: 'user', text: `${record.label}: ${message}` }, { role: 'assistant', text: result.reply });
      session.turns = session.turns.slice(-16);
      session.touchedAt = Date.now();

      res.json({
        reply: result.reply,
        steps: result.steps,
        provider: result.provider,
        ...(result.pendingConfirmation ? { pendingConfirmation: result.pendingConfirmation } : {}),
        mode: agentMode(),
        model: agentModel(),
        caller: record.clientId,
      });
    } catch (error) {
      // The full error goes to the operator's log; the client gets one generic
      // sentence, so SDK messages and file paths never reach the browser.
      console.error(`[vetwise] chat failed for ${record.clientId}:`, error);
      res.status(502).json({
        reply: `I could not reach the Vetwise service. Call your veterinarian or poison control if this is urgent.`,
        steps: [],
      });
    }
  };
}

export function stateHandler(store: Store) {
  return (req: Request, res: Response): void => {
    if (!tokenFromHeader(req.headers.authorization)) {
      res.status(401).json({ error: 'A bearer token is required.' });
      return;
    }
    res.json({
      ...publishableState(store),
      traffic: listTraffic(),
      agent: { mode: agentMode(), model: agentModel() },
    });
  };
}
