/**
 * Safety-engine tests.
 *
 * These are deliberately adversarial: every test that could produce
 * reassurance asserts the opposite when a required fact is missing. The demo
 * is only credible if the engine refuses to guess.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assessExposure, renderAssessment, type ExposureInput } from '../src/domain/exposure.js';
import { TOXINS, TOXIN_BY_ID } from '../src/domain/toxins.js';
import type { AmountUnit, Clinic, Pet, Symptom } from '../src/domain/types.js';

const CONTACTS = {
  primary: {
    id: 'cedar-creek',
    name: 'Cedar Creek Animal Hospital (Dr. Priya Raman)',
    kind: 'primary',
    phone: '+1-916-555-0142',
  },
  emergency: {
    id: 'svess',
    name: 'Sacramento Veterinary Emergency & Specialty',
    kind: 'emergency',
    phone: '+1-916-555-0199',
  },
  poisonControl: {
    id: 'apcc',
    name: 'ASPCA Animal Poison Control Center',
    kind: 'poison_control',
    phone: '(888) 426-4435',
  },
} satisfies Record<string, Clinic>;

const MOCHI: Pet = {
  id: 'mochi',
  name: 'Mochi',
  species: 'dog',
  breed: 'Pembroke Welsh Corgi',
  sex: 'female',
  neutered: true,
  ageYears: 5,
  weightKg: 13.6,
  weightUpdatedAt: '2026-11-01T15:00:00.000Z',
  conditions: [],
  allergies: [],
};

const JUNIPER: Pet = {
  ...MOCHI,
  id: 'juniper',
  name: 'Juniper',
  species: 'cat',
  breed: 'Domestic Shorthair',
  weightKg: 4.6,
};

type AssessPet = ExposureInput['pet'];

interface AssessOptions {
  pet?: AssessPet;
  amount?: { value: number; unit: AmountUnit };
  product?: string;
  symptoms?: Symptom[];
  intent?: ExposureInput['intent'];
}

function toxin(id: string) {
  const record = TOXIN_BY_ID.get(id);
  assert.ok(record, `missing toxin ${id}`);
  return record;
}

function assess(toxinId: string, options: AssessOptions = {}) {
  return assessExposure({
    pet: options.pet ?? MOCHI,
    toxin: toxin(toxinId),
    ...(options.product ? { productText: options.product } : {}),
    ...(options.amount ? { amount: options.amount } : {}),
    intent: options.intent ?? 'ingested',
    symptoms: options.symptoms ?? [],
    contacts: CONTACTS,
  });
}

/* ------------------------------------------------------------------ catalogue */

test('catalogue has unique ids and a cited source for every toxin', () => {
  const ids = new Set<string>();
  for (const entry of TOXINS) {
    assert.ok(!ids.has(entry.id), `duplicate toxin id ${entry.id}`);
    ids.add(entry.id);
    assert.ok(entry.sources.length > 0, `${entry.id} has no sources`);
    const usable = entry.sources.filter((source) => source.url && source.quote);
    assert.ok(usable.length > 0, `${entry.id} has no source with both a URL and a quote`);
    for (const band of entry.bands) {
      assert.ok(Number.isFinite(band.at) && band.at >= 0, `${entry.id} has an invalid band`);
    }
    const ascending = [...entry.bands].sort((a, b) => a.at - b.at);
    assert.deepEqual(entry.bands, ascending, `${entry.id} bands are not ascending`);
    for (const source of entry.sources) {
      assert.match(source.url ?? '', /^https:\/\//, `${entry.id} source is not https`);
    }
  }
  assert.equal(TOXINS.length, 24);
});

test('the four any-exposure toxins carry an explicit floor', () => {
  for (const [id, verdict] of [
    ['grapes', 'call_vet'],
    ['lily', 'emergency'],
    ['rodenticide', 'emergency'],
    ['ethylene-glycol', 'emergency'],
  ] as const) {
    const entry = toxin(id);
    assert.equal(entry.anyAmountVerdict, verdict, `${id} floor changed`);
    assert.equal(entry.amountOptional, true, `${id} must not require an amount`);
  }
});

/* ------------------------------------------------------------------ chocolate */

test('40 g of a 65% bar for a 13.6 kg dog is a call-vet dose, with Merck evidence', () => {
  const assessment = assess('chocolate', { amount: { value: 40, unit: 'g' }, product: '65% dark chocolate' });
  assert.equal(assessment.verdict, 'call_vet');
  assert.ok(assessment.dosePerKg !== undefined);
  assert.ok(Math.abs(assessment.dosePerKg - 29.71) < 0.01, `dose ${assessment.dosePerKg}`);
  assert.equal(assessment.threshold?.at, 20);
  assert.equal(assessment.toxin.product, '65% cocoa dark chocolate bar');

  const merck = assessment.findings.find((finding) => finding.evidence.publisher?.includes('Merck'));
  assert.ok(merck?.evidence.quote, 'no Merck quotation attached');
  assert.match(merck!.evidence.url ?? '', /merckvetmanual\.com/);
});

test('the same mass without product evidence is unverified, not reassuring', () => {
  const assessment = assess('chocolate', { amount: { value: 40, unit: 'g' } });
  assert.equal(assessment.verdict, 'unverified');
  assert.match(assessment.headline, /one more detail|verify/i);
  assert.ok(assessment.findings.some((finding) => /product/i.test(finding.detail)));
});

test('white chocolate at the same mass stays monitor rather than a toxicosis verdict', () => {
  const assessment = assess('chocolate', { amount: { value: 40, unit: 'g' }, product: 'white chocolate' });
  assert.equal(assessment.verdict, 'monitor');
  assert.ok(assessment.dosePerKg !== undefined && assessment.dosePerKg < 1);
});

test('a missing amount never becomes a dose guess', () => {
  const assessment = assess('chocolate');
  assert.equal(assessment.verdict, 'unverified');
  assert.equal(assessment.dosePerKg, undefined);
  assert.match(assessment.headline, /how much/i);
});

/* -------------------------------------------------------------------- xylitol */

test('xylitol follows the dog thresholds and refuses cats', () => {
  const low = assess('xylitol', { amount: { value: 1500, unit: 'mg' } });
  assert.equal(low.verdict, 'call_vet');
  assert.ok(low.dosePerKg !== undefined && low.dosePerKg > 100);

  const high = assess('xylitol', { amount: { value: 8000, unit: 'mg' } });
  assert.equal(high.verdict, 'emergency');
  assert.equal(high.threshold?.at, 500);

  const cat = assess('xylitol', { pet: JUNIPER, amount: { value: 8000, unit: 'mg' } });
  assert.equal(cat.verdict, 'unverified');
  assert.match(cat.summary, /not the same as safety/i);
});

/* --------------------------------------------------------------- any exposure */

test('grapes escalate on any exposure, including when the count is unknown', () => {
  const unknown = assess('grapes');
  assert.equal(unknown.verdict, 'call_vet');
  assert.equal(unknown.anyAmountRule, true);

  const one = assess('grapes', { amount: { value: 1, unit: 'pieces' } });
  assert.equal(one.verdict, 'call_vet');

  const many = assess('grapes', { amount: { value: 6, unit: 'pieces' } });
  assert.equal(many.verdict, 'emergency');
});

test('lilies are an emergency for cats and unverified for dogs', () => {
  const cat = assess('lily', { pet: JUNIPER });
  assert.equal(cat.verdict, 'emergency');
  assert.equal(cat.anyAmountRule, true);

  const dog = assess('lily', { pet: MOCHI });
  assert.equal(dog.verdict, 'unverified');
  assert.match(dog.summary, /not the same as safety/i);
});

test('rodenticide and antifreeze are emergencies without any dose math', () => {
  for (const id of ['rodenticide', 'ethylene-glycol']) {
    const assessment = assess(id);
    assert.equal(assessment.verdict, 'emergency', `${id} did not escalate`);
    assert.equal(assessment.anyAmountRule, true, `${id} lost its any-exposure rule`);
    assert.equal(assessment.dosePerKg, undefined);
  }
});

/* ---------------------------------------------------------------- uncertainty */

test('missing weight returns unverified with a concrete next step', () => {
  const assessment = assess('chocolate', {
    pet: { ...MOCHI, weightKg: undefined } as unknown as AssessPet,
    amount: { value: 40, unit: 'g' },
    product: 'dark chocolate',
  });
  assert.equal(assessment.verdict, 'unverified');
  assert.match(assessment.headline, /weight/i);
});

test('missing species returns unverified instead of assuming a dog or cat', () => {
  const assessment = assess('chocolate', {
    pet: { ...MOCHI, species: 'unknown' } as unknown as AssessPet,
    amount: { value: 40, unit: 'g' },
    product: 'dark chocolate',
  });
  assert.equal(assessment.verdict, 'unverified');
  assert.match(assessment.headline, /dog or a cat/i);
});

test('a human medicine framed as "can I give this?" is a call-vet answer, not a dose', () => {
  const assessment = assess('ibuprofen', { amount: { value: 200, unit: 'mg' }, intent: 'considering' });
  assert.equal(assessment.verdict, 'call_vet');
  assert.match(assessment.headline, /do not give/i);
});

/* ------------------------------------------------------------------- symptoms */

test('symptoms can only raise a verdict, never lower one', () => {
  const baseline = assess('chocolate', { amount: { value: 4, unit: 'g' }, product: 'dark chocolate' });
  assert.equal(baseline.verdict, 'monitor');

  const drooling = assess('chocolate', {
    amount: { value: 4, unit: 'g' },
    product: 'dark chocolate',
    symptoms: ['drooling'],
  });
  assert.equal(drooling.verdict, 'call_vet');
  assert.equal(drooling.escalation?.to, 'call_vet');

  const seizure = assess('chocolate', {
    amount: { value: 4, unit: 'g' },
    product: 'dark chocolate',
    symptoms: ['drooling', 'seizure'],
  });
  assert.equal(seizure.verdict, 'emergency');
  assert.match(seizure.headline, /emergency signs/i);

  // When the dose is already inside a published band, a symptom escalation
  // must not leave the mild band reading like the answer.
  const escalatedBand = assess('chocolate', {
    amount: { value: 40, unit: 'g' },
    product: 'dark chocolate',
    symptoms: ['tremors'],
  });
  assert.equal(escalatedBand.verdict, 'emergency');
  assert.match(escalatedBand.summary, /dose alone falls in/i);
  assert.doesNotMatch(escalatedBand.summary, /^That falls in/i);
});

test('assumption copy has one terminal period and a readable dash', () => {
  const assessment = assess('chocolate', { amount: { value: 40, unit: 'g' }, product: 'dark chocolate' });
  const assumption = assessment.assumptions.find((entry) => entry.startsWith('Product assumed:'));
  assert.ok(assumption, 'expected a product assumption');
  assert.match(assumption, /bar — A 65% cocoa bar/);
  assert.doesNotMatch(assumption, /\.\.$/);
});

test('a caller cannot use a mild symptom to downgrade an any-exposure emergency', () => {
  const assessment = assess('rodenticide', { symptoms: ['vomiting'] });
  assert.equal(assessment.verdict, 'emergency');
});

/* ------------------------------------------------------------------ rendering */

test('rendered text always names a clinic and never advises home treatment', () => {
  const assessment = assess('chocolate', { amount: { value: 40, unit: 'g' }, product: 'dark chocolate' });
  const text = renderAssessment(assessment);
  assert.match(text, /\+1-916-555-0142/);
  assert.match(text, /ASPCA|poison control/i);
  assert.doesNotMatch(text, /induce vomiting at home|give \d+ ?mg|treat at home/i);
  assert.match(text, /Evidence:/);
});
