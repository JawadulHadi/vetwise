import type { NextFunction, Response } from 'express';
import type { AuthedRequest } from './auth.js';
import { currentEpoch, requestStartEpoch } from './fence.js';

export interface TrafficEntry {
  id: number;
  at: string;
  method: string;
  tool?: string;
  resource?: string;
  prompt?: string;
  clientId?: string;
  durationMs: number;
  status: number;
}

const MAX_ENTRIES = 80;
const entries: TrafficEntry[] = [];
let counter = 0;

export function listTraffic(): TrafficEntry[] {
  return [...entries];
}

export function clearTraffic(): void {
  entries.length = 0;
}

/**
 * Records JSON-RPC method + tool name for the on-screen "MCP traffic" panel.
 * Every answer in the UI has a matching tools/call in this log.
 */
export function recordTraffic(req: AuthedRequest, res: Response, next: NextFunction): void {
  const startedAt = performance.now();
  const startedIn = requestStartEpoch() ?? currentEpoch();
  const body = req.body as { method?: string; params?: { name?: string; uri?: string } } | undefined;
  const method = body?.method ?? 'unknown';
  const entry: TrafficEntry = {
    id: ++counter,
    at: new Date().toISOString(),
    method,
    ...(method === 'tools/call' && body?.params?.name ? { tool: body.params.name } : {}),
    ...(method === 'resources/read' && body?.params?.uri ? { resource: body.params.uri } : {}),
    ...(method === 'prompts/get' && body?.params?.name ? { prompt: body.params.name } : {}),
    ...(req.auth?.clientId ? { clientId: req.auth.clientId } : {}),
    durationMs: 0,
    status: 0,
  };

  res.on('finish', () => {
    entry.durationMs = Math.round(performance.now() - startedAt);
    entry.status = res.statusCode;
    if (method === 'unknown') return; // GET stream opens and bare probes are noise.
    if (startedIn !== currentEpoch()) return; // started before a public-demo reset
    entries.unshift(entry);
    entries.length = Math.min(entries.length, MAX_ENTRIES);
  });

  next();
}
