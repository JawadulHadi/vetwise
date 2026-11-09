import path from 'node:path';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import express from 'express';
import { agentMode, agentModel } from './agent/run.js';
import { assertBedrockReady } from './agent/bedrock.js';
import { config } from './config.js';
import { chatHandler, clearSessions, demoReset, stateHandler } from './http/chat.js';
import { bearerAuth, optionalAuth } from './http/auth.js';
import { rateLimit } from './http/limits.js';
import { fenceRequest } from './http/fence.js';
import { clearTraffic, recordTraffic } from './http/traffic.js';
import { createServerFactory } from './mcp/server.js';
import { Store } from './store/store.js';
import { seedDatabase } from './store/seed.js';

const store = await Store.open(config.dataFile, seedDatabase);
const mcpHandler = createMcpHandler(createServerFactory(store), { responseMode: 'sse' });
const nodeHandler = toNodeHandler(mcpHandler);

const app = createMcpExpressApp({
  host: config.host,
  ...(config.allowedHosts.length > 0 ? { allowedHosts: config.allowedHosts } : {}),
  ...(config.allowedOrigins.length > 0 ? { allowedOrigins: config.allowedOrigins } : {}),
});

/**
 * Security headers for the static simulator. The page loads only its own module,
 * stylesheet and inline SVG data URIs, so the policy can be strict; nothing here
 * needs `unsafe-inline` or a third-party origin.
 */
app.use((_req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "media-src 'self' blob:",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), payment=()');
  next();
});

// The MCP endpoint: bearer token → traffic log → Streamable HTTP handler.
// Scopes are re-checked inside every tool, resource and prompt, so a token that
// reaches this far still cannot write outside what it was granted.
app.all('/mcp', demoInService, fenceRequest, bearerAuth, recordTraffic, (req, res) => {
  void nodeHandler(req, res, req.body);
});

// Reset failures share demoReset.failed with the timer and access guard.
// Keep deployment details private while reporting cleanup readiness.
app.get('/healthz', (_req, res) => {
  if (demoReset.failed) {
    res.status(503).json({ ok: false, time: new Date().toISOString() });
    return;
  }
  res.json({ ok: true, time: new Date().toISOString() });
});

// Include static demo access and identity requests in the cleanup guard.
app.use(demoInService);

/** While a failed public-demo reset is unresolved, the demo is out of service. */
function demoInService(_req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (demoReset.failed) {
    res.status(503).json({ error: 'The public demo is resetting. Try again in a minute.' });
    return;
  }
  next();
}

// Each chat turn can cost several model calls, so the budget is per bearer
// token rather than per IP: a shared office address does not pool its limit.
app.post('/api/chat', demoInService, fenceRequest, rateLimit({ windowMs: 60_000, max: 20, scope: 'chat' }), chatHandler(store));
app.get('/api/state', demoInService, rateLimit({ windowMs: 60_000, max: 240, scope: 'state' }), stateHandler(store));
app.get('/api/whoami', optionalAuth, (req, res) => {
  // This reflects the token that was actually presented — never a hard-coded
  // or empty answer, so the simulator can always show who is speaking.
  if (!req.auth) {
    res.json(null);
    return;
  }
  const label = config.tokens.find((entry) => entry.clientId === req.auth!.clientId)?.label ?? req.auth.clientId;
  // `req.auth.token` is a hint (first four characters), never the credential.
  res.json({ clientId: req.auth.clientId, scopes: req.auth.scopes, token: req.auth.token, label });
});

app.use(express.static(path.resolve('web'), { extensions: ['html'] }));

/**
 * Two startup checks that turn a silent misconfiguration into a clear failure:
 * the self-call URL the chat route dials, and the Bedrock credentials the agent
 * will use.
 */
async function checkSelfCall(): Promise<void> {
  const url = `${config.publicBaseUrl.replace(/\/$/, '')}/mcp`;
  try {
    const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5_000) });
    // 401 is the healthy answer: the endpoint is reachable and refusing us.
    if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    console.warn(
      `[vetwise] PUBLIC_BASE_URL does not reach this server (${url}: ${(error as Error).message}). ` +
        'The simulator chat will fail until this points at the server’s own /mcp endpoint.',
    );
  }
}

// Single-process store: two processes sharing data/db.json would race on writes.
if (process.env.WEB_CONCURRENCY && Number(process.env.WEB_CONCURRENCY) > 1) {
  console.warn(
    '[vetwise] WEB_CONCURRENCY > 1 with the JSON-file store. Writes are only serialised inside one process; ' +
      'run a single instance or move to a database with OS-level locking.',
  );
}

if (agentMode() === 'bedrock') await assertBedrockReady();

// Public demo: reseed the household, and drop transcripts and the traffic log,
// on a fixed interval so one visitor's changes never become the next one's story.
// The next reset is scheduled only after this one has finished, so resets can
// never pile up in the write queue ahead of visitors' writes.
let resetTimer: NodeJS.Timeout | undefined;
if (config.demoResetMinutes > 0) {
  const intervalMs = config.demoResetMinutes * 60_000;
  demoReset.minutes = config.demoResetMinutes;
  const scheduleReset = (delayMs: number): void => {
    demoReset.nextAt = new Date(Date.now() + delayMs).toISOString();
    resetTimer = setTimeout(() => {
      store
        .reset(seedDatabase)
        .then(() => {
          demoReset.failed = false;
          console.log('[vetwise] public demo reset — household reseeded');
        })
        .catch((error: unknown) => {
          // Out of service until a reset succeeds: /healthz reports 503 and the
          // demo routes refuse, so no visitor sees state that was meant to be wiped.
          demoReset.failed = true;
          console.error('[vetwise] public demo reset failed; demo is out of service until a reset succeeds', error);
        })
        .finally(() => {
          // Transcripts and traffic go either way; they are only ever in memory.
          clearSessions();
          clearTraffic();
          scheduleReset(demoReset.failed ? Math.min(intervalMs, 30_000) : intervalMs);
        });
    }, delayMs);
    resetTimer.unref();
  };
  scheduleReset(intervalMs);
}

const server = app.listen(config.port, config.host, () => {
  const url = `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}`;
  console.log(`Vetwise listening on ${url}`);
  console.log(`  MCP endpoint   ${url}/mcp`);
  console.log(`  Household demo ${url}/`);
  console.log(`  Data file      ${config.dataFile}`);
  console.log(`  Agent          ${agentMode()} (${agentModel()})`);
  if (config.demoClock) console.log(`  Demo clock     ${config.demoClock}`);
  console.log(`  Tokens         ${config.tokens.map((entry) => `${entry.label}: ${entry.tokenHint}`).join(' | ')}`);
  if (config.demoMode) console.log('  Credentials    published demo tokens (see .env.example)');
  if (config.demoResetMinutes > 0) console.log(`  Demo reset     every ${config.demoResetMinutes} min`);
  // Checked after the socket is open: the endpoint is this same process.
  void checkSelfCall();
});

async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal} received — closing MCP handler and HTTP server.`);
  if (resetTimer) clearTimeout(resetTimer);
  await mcpHandler.close().catch(() => undefined);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
