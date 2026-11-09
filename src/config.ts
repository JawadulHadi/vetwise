import path from 'node:path';
import { hashToken } from './hash.js';

function parseClock(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  // "21:40" -> today at 21:40 local time. Keeps demo recordings deterministic.
  if (/^\d{2}:\d{2}$/.test(trimmed)) return trimmed;
  // A full ISO timestamp is honoured as-is.
  if (!Number.isNaN(Date.parse(trimmed))) return trimmed;
  return undefined;
}

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const isProduction = process.env.NODE_ENV === 'production';

/**
 * Demo credentials exist so `npm start` works on a fresh clone. They are only
 * allowed when the operator has not declared this a production deployment:
 * `NODE_ENV=production` (or `VETWISE_DEMO=0`) requires explicit tokens and the
 * well-known demo strings are rejected outright.
 */
const demoMode = process.env.VETWISE_DEMO === '1' || (!isProduction && process.env.VETWISE_DEMO !== '0');
const DEMO_TOKENS = { owner: 'maya-owner-demo-token', sitter: 'noah-sitter-demo-token' } as const;

function resolveToken(envName: 'OWNER_TOKEN' | 'SITTER_TOKEN', demoValue: string): string {
  const explicit = process.env[envName]?.trim();
  if (explicit) {
    if (isProduction && explicit === demoValue) {
      throw new Error(
        `${envName} is set to a published demo token. Set a unique secret before running with NODE_ENV=production.`,
      );
    }
    return explicit;
  }
  if (isProduction || !demoMode) {
    throw new Error(
      `${envName} must be set. Vetwise no longer falls back to published demo tokens outside demo mode. ` +
        'Set OWNER_TOKEN and SITTER_TOKEN, or start with VETWISE_DEMO=1 for the local demo.',
    );
  }
  console.warn(
    `[vetwise] DEMO CREDENTIALS ACTIVE — ${envName} is unset, so the published demo token is in use. ` +
      'Set OWNER_TOKEN/SITTER_TOKEN (or VETWISE_DEMO=0) before exposing this server.',
  );
  return demoValue;
}

const demoTokensActive = !process.env.OWNER_TOKEN?.trim() || !process.env.SITTER_TOKEN?.trim();
const ownerToken = resolveToken('OWNER_TOKEN', DEMO_TOKENS.owner);
const sitterToken = resolveToken('SITTER_TOKEN', DEMO_TOKENS.sitter);

const demoClock = parseClock(process.env.DEMO_CLOCK);
if (demoClock && isProduction) {
  throw new Error(
    'DEMO_CLOCK is set while NODE_ENV=production. A frozen clock breaks care-slot timing; unset it.',
  );
}
if (demoClock) {
  console.warn(`[vetwise] DEMO_CLOCK=${demoClock} — the clock is frozen. Never use this outside the demo.`);
}

/**
 * Public-demo reset: when set, the household is reseeded every N minutes so a
 * hosted demo that strangers can write to always returns to its story. It wipes
 * the record, so it is refused under NODE_ENV=production.
 */
const rawReset = process.env.VETWISE_DEMO_RESET_MINUTES?.trim();
const demoResetMinutes = rawReset ? Number(rawReset) : 0;
if (rawReset && (!Number.isFinite(demoResetMinutes) || demoResetMinutes <= 0)) {
  throw new Error(`VETWISE_DEMO_RESET_MINUTES must be a positive number of minutes, got "${rawReset}".`);
}
if (demoResetMinutes * 60_000 > 2_147_483_647) {
  throw new Error('VETWISE_DEMO_RESET_MINUTES exceeds Node’s maximum timer delay (2147483647 ms).');
}
if (demoResetMinutes > 0 && isProduction) {
  throw new Error(
    'VETWISE_DEMO_RESET_MINUTES is set while NODE_ENV=production. The reset wipes the household record; it is for public demos only.',
  );
}

const agentChoice = process.env.VETWISE_AGENT;
if (agentChoice === 'bedrock' && !process.env.BEDROCK_MODEL_ID?.trim()) {
  throw new Error(
    'VETWISE_AGENT=bedrock requires BEDROCK_MODEL_ID. Choosing the model tier for a safety tool is an operator decision, not a default.',
  );
}

export const config = {
  port,
  host,
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`,
  dataFile: process.env.VETWISE_DATA ?? path.resolve('data/db.json'),
  demoClock,
  demoResetMinutes,
  isProduction,
  demoMode: demoMode && demoTokensActive,
  allowedHosts: (process.env.ALLOWED_HOSTS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  bedrock: {
    region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
    modelId: process.env.BEDROCK_MODEL_ID ?? 'amazon.nova-lite-v1:0',
  },
  caregiverWebhookUrl: process.env.CAREGIVER_WEBHOOK_URL,
  /**
   * Bearer tokens, stored as SHA-256 digests. The plaintext only exists in the
   * environment and in the caller's own request.
   */
  tokens: [
    {
      tokenHash: hashToken(ownerToken),
      tokenHint: `${ownerToken.slice(0, 4)}…`,
      clientId: 'maya',
      label: 'Maya Chen (owner)',
      scopes: ['vetwise.read', 'vetwise.log', 'vetwise.write', 'vetwise.notify'],
    },
    {
      tokenHash: hashToken(sitterToken),
      tokenHint: `${sitterToken.slice(0, 4)}…`,
      clientId: 'noah',
      label: 'Noah Patel (pet sitter)',
      scopes: ['vetwise.read', 'vetwise.log', 'vetwise.notify'],
    },
  ],
} as const;

export type TokenRecord = (typeof config.tokens)[number];
