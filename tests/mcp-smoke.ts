/**
 * End-to-end smoke test: boot the real HTTP server, then drive it with a real
 * MCP client over Streamable HTTP — the same path an Alexa+ host would take.
 *
 * Every assertion here goes through the transport, the bearer-token gate and
 * the in-tool scope checks. Nothing is imported from `src/` directly.
 *
 *   npm run smoke
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const PORT = Number(process.env.SMOKE_PORT ?? 8799);
const BASE = `http://127.0.0.1:${PORT}`;
const OWNER = 'maya-owner-smoke-token';
const SITTER = 'noah-sitter-smoke-token';

const directory = await mkdtemp(path.join(tmpdir(), 'vetwise-smoke-'));
const dataFile = path.join(directory, 'db.json');

const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    VETWISE_DATA: dataFile,
    DEMO_CLOCK: '21:40',
    VETWISE_AGENT: 'scripted',
    OWNER_TOKEN: OWNER,
    SITTER_TOKEN: SITTER,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.on('data', (chunk) => process.env.SMOKE_VERBOSE && process.stdout.write(chunk));
child.stderr.on('data', (chunk) => process.stderr.write(chunk));

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/healthz`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('server did not start');
}

async function connect(token: string): Promise<Client> {
  const client = new Client({ name: 'vetwise-smoke', version: '0.1.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

type StructuredToolResult = {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
};

function ok(result: StructuredToolResult, label: string): Record<string, unknown> {
  assert.notEqual(result.isError, true, `${label} failed: ${result.content?.[0]?.text ?? ''}`);
  assert.ok(result.structuredContent, `${label} returned no structured content`);
  return result.structuredContent!;
}

try {
  await waitForServer();
  const owner = await connect(OWNER);

  /* ---------------------------------------------------------------- tools */

  const tools = await owner.listTools();
  const names = tools.tools.map((tool) => tool.name).sort();
  assert.equal(names.length, 9, `expected 9 tools, saw ${names.join(', ')}`);
  for (const required of [
    'get_household',
    'get_pet',
    'get_care_summary',
    'list_medications',
    'assess_toxin_exposure',
    'log_care_event',
    'propose_record_change',
    'apply_record_change',
    'alert_caregiver',
  ]) {
    assert.ok(names.includes(required), `missing tool ${required}`);
  }
  console.log(`✓ tools/list — ${names.length} tools`);

  /* ------------------------------------------------------------ care state */

  const household = ok(
    (await owner.callTool({ name: 'get_household', arguments: {} })) as StructuredToolResult,
    'get_household',
  );
  assert.equal((household.pets as unknown[]).length, 2);
  assert.equal((household.people as unknown[]).length, 2);
  console.log('✓ get_household — 2 people, 2 pets');

  const care = ok(
    (await owner.callTool({ name: 'get_care_summary', arguments: {} })) as StructuredToolResult,
    'get_care_summary',
  );
  assert.equal(care.taken, 2, 'morning doses should be taken');
  assert.equal(care.due, 2, 'evening doses should be due at 21:40');
  assert.equal(care.upcoming, 0);
  console.log('✓ get_care_summary — 2 taken, 2 due at 21:40');

  const meds = ok(
    (await owner.callTool({ name: 'list_medications', arguments: { status: 'all' } })) as StructuredToolResult,
    'list_medications',
  );
  const medicationList = meds.medications as Array<{ name: string; status: string }>;
  assert.equal(medicationList.length, 5, `expected 5 medicines including the stopped one`);
  assert.ok(
    medicationList.some(
      (medication) => medication.name.toLowerCase() === 'trazodone' && medication.status === 'stopped',
    ),
  );
  console.log(`✓ list_medications status=all — ${medicationList.map((medication) => medication.name).join(', ')}`);

  /* ----------------------------------------------------- toxin assessments */

  const chocolate = ok(
    (await owner.callTool({
      name: 'assess_toxin_exposure',
      arguments: { pet: 'Mochi', substance: 'chocolate', product: '65% dark chocolate', amountValue: 40, amountUnit: 'g' },
    })) as StructuredToolResult,
    'chocolate assessment',
  );
  assert.equal(chocolate.verdict, 'call_vet');
  assert.ok(Math.abs((chocolate.dosePerKg as number) - 29.71) < 0.01, `chocolate dose ${chocolate.dosePerKg}`);
  assert.ok(
    (chocolate.findings as Array<{ evidence?: { publisher?: string } }>).some((finding) =>
      finding.evidence?.publisher?.includes('Merck'),
    ),
    'chocolate verdict is not cited to Merck',
  );
  assert.equal(chocolate.recorded, true);
  console.log(`✓ assess chocolate — call_vet at ${chocolate.dosePerKg} mg/kg, Merck citation, recorded`);

  const lily = ok(
    (await owner.callTool({
      name: 'assess_toxin_exposure',
      arguments: { pet: 'Juniper', substance: 'lily' },
    })) as StructuredToolResult,
    'lily assessment',
  );
  assert.equal(lily.verdict, 'emergency');
  assert.equal(lily.anyAmountRule, true);
  assert.equal(lily.dosePerKg, undefined);
  console.log('✓ assess lily for a cat — emergency on any exposure, no dose math');

  const xylitolDog = ok(
    (await owner.callTool({
      name: 'assess_toxin_exposure',
      arguments: { pet: 'Mochi', substance: 'xylitol', amountValue: 8000, amountUnit: 'mg' },
    })) as StructuredToolResult,
    'xylitol dog assessment',
  );
  assert.equal(xylitolDog.verdict, 'emergency');

  const xylitolCat = ok(
    (await owner.callTool({
      name: 'assess_toxin_exposure',
      arguments: { pet: 'Juniper', substance: 'xylitol', amountValue: 8000, amountUnit: 'mg' },
    })) as StructuredToolResult,
    'xylitol cat assessment',
  );
  assert.equal(xylitolCat.verdict, 'unverified');
  console.log('✓ assess xylitol — emergency for the dog, unverified for the cat');

  const unknown = ok(
    (await owner.callTool({
      name: 'assess_toxin_exposure',
      arguments: { pet: 'Mochi', substance: 'glitter glue', amountValue: 10, amountUnit: 'g' },
    })) as StructuredToolResult,
    'unknown substance assessment',
  );
  assert.equal(unknown.verdict, 'unverified');
  assert.match(String(unknown.headline), /verif|catalogue/i);
  assert.match(String(unknown.summary), /not the same as safety|not reassuring|poison control|unverified/i);
  console.log('✓ assess unknown substance — unverified, never reassurance');

  /* ------------------------------------------------------------- care write */

  const logged = ok(
    (await owner.callTool({
      name: 'log_care_event',
      arguments: { pet: 'Mochi', kind: 'medication', medication: 'gabapentin', scheduledTime: '21:00' },
    })) as StructuredToolResult,
    'log_care_event',
  );
  assert.match(String(logged.message), /gabapentin/i);
  console.log('✓ log_care_event — gabapentin 21:00 marked taken');

  const after = ok(
    (await owner.callTool({ name: 'get_care_summary', arguments: {} })) as StructuredToolResult,
    'care summary after logging',
  );
  assert.equal(after.taken, 3);
  assert.equal(after.due, 1);
  console.log('✓ care summary reflects the log — 3 taken, 1 due');

  /* ---------------------------------------------------------------- alerts */

  const alert = ok(
    (await owner.callTool({
      name: 'alert_caregiver',
      arguments: { to: 'Maya', body: 'Mochi ate dark chocolate. Call the vet.' },
    })) as StructuredToolResult,
    'alert_caregiver',
  );
  assert.match(String(alert.to), /\+1-916-555-0121/);
  assert.equal(alert.status, 'queued');

  const outside = (await owner.callTool({
    name: 'alert_caregiver',
    arguments: { to: '+1-555-999-0000', body: 'Outside contact' },
  })) as StructuredToolResult;
  assert.equal(outside.isError, true);
  assert.match(outside.content?.[0]?.text ?? '', /only alert people in this household/);
  console.log('✓ alert_caregiver — household only, outside contact rejected');

  /* ------------------------------------------------------- two-phase change */

  const proposal = ok(
    (await owner.callTool({
      name: 'propose_record_change',
      arguments: {
        action: 'medication.stop',
        pet: 'Mochi',
        medication: 'carprofen',
        reason: 'the vet said to stop it',
      },
    })) as StructuredToolResult,
    'propose_record_change',
  );
  const token = String(proposal.token);
  assert.match(token, /^vw_/);
  assert.equal(proposal.requiresConfirmation, true);
  assert.match(String(proposal.summary), /Stop Carprofen/);

  const beforeApply = ok(
    (await owner.callTool({ name: 'get_pet', arguments: { pet: 'Mochi' } })) as StructuredToolResult,
    'get_pet before apply',
  );
  const carprofenBefore = (beforeApply.medications as Array<{ name: string; status: string }>).find(
    (medication) => medication.name.toLowerCase() === 'carprofen',
  );
  assert.equal(carprofenBefore?.status, 'active', 'proposing must not change the record');

  const applied = ok(
    (await owner.callTool({ name: 'apply_record_change', arguments: { token } })) as StructuredToolResult,
    'apply_record_change',
  );
  assert.match(String(applied.summary), /Stop(?:ped)? Carprofen/);
  console.log('✓ propose + apply — record changed only after the token');

  const carried = ok(
    (await owner.callTool({ name: 'get_pet', arguments: { pet: 'Mochi' } })) as StructuredToolResult,
    'get_pet after apply',
  );
  const carprofenAfter = (carried.medications as Array<{ name: string; status: string }>).find(
    (medication) => medication.name.toLowerCase() === 'carprofen',
  );
  assert.equal(carprofenAfter?.status, 'stopped');

  const replay = (await owner.callTool({ name: 'apply_record_change', arguments: { token } })) as StructuredToolResult;
  assert.equal(replay.isError, true, 'a confirmation code must not be reusable');
  assert.match(replay.content?.[0]?.text ?? '', /already used/);
  console.log('✓ confirmation tokens are single use');

  /* ------------------------------------------------------- resources/prompts */

  const resources = await owner.listResources();
  const resourceUris = resources.resources.map((resource) => resource.uri);
  for (const uri of ['vetwise://household', 'vetwise://care/today', 'vetwise://medications', 'vetwise://toxins']) {
    assert.ok(resourceUris.includes(uri), `missing resource ${uri}`);
  }
  const householdResource = await owner.readResource({ uri: 'vetwise://household' });
  assert.match((householdResource.contents[0] as { text?: string }).text ?? '', /Mochi/);
  const toxinsResource = await owner.readResource({ uri: 'vetwise://toxins' });
  assert.match((toxinsResource.contents[0] as { text?: string }).text ?? '', /chocolate/);
  console.log(`✓ resources — ${resourceUris.length} listed, household and toxin index read`);

  const prompts = await owner.listPrompts();
  const promptNames = prompts.prompts.map((prompt) => prompt.name).sort();
  assert.deepEqual(promptNames, ['evening_check_in', 'something_my_pet_ate']);
  const evening = await owner.getPrompt({ name: 'evening_check_in', arguments: {} });
  assert.ok(evening.messages.length >= 1);
  console.log('✓ prompts — evening_check_in and something_my_pet_ate');

  await owner.close();

  /* ------------------------------------------------------------------ sitter */

  const sitter = await connect(SITTER);

  const sitterRead = ok(
    (await sitter.callTool({ name: 'list_medications', arguments: {} })) as StructuredToolResult,
    'sitter read',
  );
  assert.ok((sitterRead.medications as unknown[]).length > 0);

  const sitterAssess = ok(
    (await sitter.callTool({
      name: 'assess_toxin_exposure',
      arguments: { pet: 'Juniper', substance: 'lily' },
    })) as StructuredToolResult,
    'sitter assess',
  );
  assert.equal(sitterAssess.verdict, 'emergency');
  assert.equal(sitterAssess.recorded, true, 'the sitter has vetwise.log and should record the exposure');

  const sitterWrite = (await sitter.callTool({
    name: 'propose_record_change',
    arguments: { action: 'medication.stop', pet: 'Mochi', medication: 'gabapentin' },
  })) as StructuredToolResult;
  assert.equal(sitterWrite.isError, true);
  assert.match(sitterWrite.content?.[0]?.text ?? '', /vetwise\.write/);
  console.log('✓ sitter — can read, assess and log; cannot change the record');

  await sitter.close();

  /* -------------------------------------------------------------------- auth */

  const unauth = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(unauth.status, 401);
  const bad = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      Authorization: 'Bearer not-a-real-token',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(bad.status, 401);
  console.log('✓ unauthenticated and unknown tokens are rejected with 401');

  console.log('\nSmoke test passed.');
} finally {
  child.kill();
  await rm(directory, { recursive: true, force: true }).catch(() => undefined);
}
