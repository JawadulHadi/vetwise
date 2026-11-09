import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { Store } from '../src/store/store.js';
import { mintConfirmation, applyConfirmation } from '../src/domain/confirmations.js';

test('reset publishes only after persistence and recovers after failure', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'reset-'));
  const file = path.join(dir, 'db.json');
  try {
    const store = await Store.open(file, db => { db.household.name = 'original'; });
    await rm(file);
    await mkdir(file);
    await assert.rejects(store.reset(db => { db.household.name = 'replacement'; }));
    assert.equal(store.read(db => db.household.name), 'original');
    assert.equal(store.revision, 0);
    await rm(file, { recursive: true });
    await store.reset(db => { db.household.name = 'replacement'; });
    assert.equal(store.read(db => db.household.name), 'replacement');
    assert.equal(JSON.parse(await readFile(file, 'utf8')).household.name, 'replacement');
    assert.equal(store.revision, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('confirmations expire on wall time with a frozen narrative clock', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'confirmation-'));
  try {
    const store = await Store.open(path.join(dir, 'db.json'), () => {});
    const before = Date.now();
    const minted = await mintConfirmation(store, { action: 'test', payload: {}, clientId: 'maya', ttlMinutes: 0 });
    const record = store.read(db => db.confirmations[0]!);
    assert.ok(Date.parse(record.createdAt) >= before);
    await assert.rejects(applyConfirmation(store, minted.token, {
      actions: ['test'], clientId: 'maya', apply: () => { throw new Error('must not apply'); },
    }), /expired/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('reset interval rejects timer overflow and preserves valid and invalid bounds', () => {
  for (const [value, accepted] of [['35791', true], ['35792', false], ['1e100', false], ['0', false], ['-1', false], ['NaN', false]] as const) {
    const child = spawnSync(process.execPath, ['--import', 'tsx', '-e', "import('./src/config.ts')"], {
      env: { ...process.env, NODE_ENV: 'development', VETWISE_DEMO: '1', VETWISE_DEMO_RESET_MINUTES: value },
      encoding: 'utf8',
    });
    assert.equal(child.status === 0, accepted, `${value}: ${child.stderr}`);
    assert.doesNotMatch(child.stderr, /TimeoutOverflowWarning/);
  }
});

test('reset notice keeps overdue and unknown states until a fresh deadline', async () => {
  const source = await readFile('web/app.js', 'utf8');
  const section = source.slice(source.indexOf('let latestDemoReset;'), source.indexOf('function renderState('));
  const notice = { hidden: true, textContent: '', title: '' };
  const context = vm.createContext({ els: { demoReset: notice }, Date });
  vm.runInContext(section, context);
  const render = (deadline?: string) => {
    context.demo = { nextResetAt: deadline, resetMinutes: 30 };
    vm.runInContext('renderDemoReset(demo)', context);
  };
  render(new Date(Date.now() + 120_000).toISOString());
  assert.match(notice.textContent, /resets in 2 min/);
  render(new Date(Date.now() - 1_000).toISOString());
  assert.match(notice.textContent, /overdue/);
  vm.runInContext('renderDemoReset(latestDemoReset)', context);
  assert.match(notice.textContent, /overdue/);
  render();
  assert.equal(notice.hidden, false);
  assert.match(notice.textContent, /unknown/);
  render(new Date(Date.now() + 120_000).toISOString());
  assert.match(notice.textContent, /resets in 2 min/);
});
