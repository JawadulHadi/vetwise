import type { Request, Response } from 'express';
import { agentMode, agentModel, runAgent } from '../agent/run.js';
import { withMcpClient } from '../agent/mcp.js';
import type { ScriptedContext, ScriptedState } from '../agent/scripted.js';
import { config } from '../config.js';
import { owner, petName } from '../domain/care.js';
import { publishableState } from '../mcp/auth.js';
import type { Store } from '../store/store.js';
import { listTraffic } from './traffic.js';
import { tokenFromHeader } from './auth.js';

interface Session {
  transcript: string[];
  scripted: ScriptedState;
}

const sessions = new Map<string, Session>();

function sessionFor(id: string): Session {
  const existing = sessions.get(id);
  if (existing) return existing;
  const created: Session = { transcript: [], scripted: {} };
  sessions.set(id, created);
  return created;
}

function contextFor(store: Store): ScriptedContext {
  return store.read((db) => {
    const primary = owner(db);
    const sitter = db.people.find((person) => person.role === 'sitter');
    return {
      ownerName: primary?.name ?? 'the owner',
      sitterName: sitter?.name ?? 'the sitter',
      people: db.people.map((person) => person.name),
      pets: db.pets.map((pet) => ({ name: pet.name, species: pet.species, weightKg: pet.weightKg })),
      medications: db.medications.map((medication) => ({
        name: medication.name,
        petName: petName(db, medication.petId),
        times: medication.schedule.map((slot) => slot.time),
      })),
    };
  });
}

export function chatHandler(store: Store) {
  return async (req: Request, res: Response): Promise<void> => {
    const record = tokenFromHeader(req.headers.authorization);
    if (!record) {
      res.status(401).json({ error: 'A bearer token is required.' });
      return;
    }

    const body = req.body as { sessionId?: string; message?: string } | undefined;
    const message = (body?.message ?? '').trim();
    if (!message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const session = sessionFor(body?.sessionId?.slice(0, 64) || 'default');

    try {
      const result = await withMcpClient({ url: `${config.publicBaseUrl}/mcp`, token: record.token }, (client) =>
        runAgent({
          client,
          message,
          transcript: session.transcript.slice(-8).join('\n'),
          context: contextFor(store),
          scriptedState: session.scripted,
        }),
      );

      session.transcript.push(`${record.label}: ${message}`, `Vetwise: ${result.reply}`);
      session.transcript = session.transcript.slice(-16);

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
      res.status(500).json({
        reply: 'I could not reach the Vetwise service. Try again in a moment.',
        error: (error as Error).message,
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
