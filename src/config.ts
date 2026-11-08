import path from 'node:path';

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

export const config = {
  port,
  host,
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`,
  dataFile: process.env.VETWISE_DATA ?? path.resolve('data/db.json'),
  demoClock: parseClock(process.env.DEMO_CLOCK),
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
  /** Bearer tokens. Override in .env for anything beyond the recorded demo. */
  tokens: [
    {
      token: process.env.OWNER_TOKEN ?? 'maya-owner-demo-token',
      clientId: 'maya',
      label: 'Maya Chen (owner)',
      scopes: ['vetwise.read', 'vetwise.log', 'vetwise.write', 'vetwise.notify'],
    },
    {
      token: process.env.SITTER_TOKEN ?? 'noah-sitter-demo-token',
      clientId: 'noah',
      label: 'Noah Patel (pet sitter)',
      scopes: ['vetwise.read', 'vetwise.log', 'vetwise.notify'],
    },
  ],
} as const;

export type TokenRecord = (typeof config.tokens)[number];
