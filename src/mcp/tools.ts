import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { atLocalTime, formatTime, isDayKey, now, todayKey } from '../clock.js';
import { sanitiseAlertBody, sendCaregiverAlert } from '../domain/alerts.js';
import {
  careSummary,
  CareError,
  findMedication,
  findPerson,
  findPet,
  listMedications,
  logCareEvent,
  prescriberName,
} from '../domain/care.js';
import { applyConfirmation, audit, ConfirmationError, mintConfirmation } from '../domain/confirmations.js';
import { assessExposure, renderAssessment, type ExposureContacts } from '../domain/exposure.js';
import { findToxin, TOXIN_COUNT } from '../domain/toxins.js';
import type {
  AmountUnit,
  CareSummary,
  Database,
  Exposure,
  ExposureAssessment,
  ExposureFinding,
  Medication,
  Pet,
  Symptom,
  Verdict,
} from '../domain/types.js';
import { newId, type Store } from '../store/store.js';
import { callerLabel, requireScope, SCOPES, ScopeError } from './auth.js';

/* ------------------------------------------------------------------ *
 * Shared vocabulary
 * ------------------------------------------------------------------ */

const UNIT_VALUES = [
  'mg',
  'g',
  'kg',
  'ml',
  'oz',
  'piece',
  'pieces',
  'tablet',
  'tablets',
  'bar',
  'bars',
  'square',
  'squares',
  'tsp',
  'tbsp',
] as const;

const SYMPTOM_VALUES = [
  'vomiting',
  'diarrhea',
  'lethargy',
  'tremors',
  'seizure',
  'collapse',
  'difficulty_breathing',
  'drooling',
  'abdominal_pain',
] as const;

const VERDICT_VALUES = ['emergency', 'call_vet', 'monitor', 'no_known_toxicity', 'unverified'] as const;

const CATEGORY_VALUES = [
  'food',
  'plant',
  'human_medication',
  'household',
  'pesticide',
  'metal',
  'recreational',
  'unknown',
] as const;

const SEVERE_SYMPTOMS = new Set<Symptom>(['seizure', 'collapse', 'difficulty_breathing', 'tremors']);
const MODERATE_SYMPTOMS = new Set<Symptom>(['vomiting', 'diarrhea', 'lethargy', 'drooling', 'abdominal_pain']);

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const RECORD_CHANGE_ACTIONS = [
  'medication.stop',
  'medication.pause',
  'medication.resume',
  'medication.add',
  'pet.weight',
] as const;

/* ------------------------------------------------------------------ *
 * Zod schemas: shared output shapes
 * ------------------------------------------------------------------ */

const verdictSchema = z.enum(VERDICT_VALUES);
const categorySchema = z.enum(CATEGORY_VALUES);
const amountUnitSchema = z.enum(UNIT_VALUES);
const symptomSchema = z.enum(SYMPTOM_VALUES);

const allergySchema = z.object({
  substance: z.string(),
  reaction: z.string(),
  severity: z.enum(['mild', 'moderate', 'severe']),
});

const petSchema = z.object({
  id: z.string(),
  name: z.string(),
  species: z.enum(['dog', 'cat']),
  breed: z.string(),
  sex: z.enum(['female', 'male']),
  neutered: z.boolean(),
  ageYears: z.number(),
  weightKg: z.number(),
  weightUpdatedAt: z.string(),
  conditions: z.array(z.string()),
  allergies: z.array(allergySchema),
  microchip: z.string().optional(),
  diet: z.string().optional(),
  notes: z.string().optional(),
});

const personSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(['owner', 'sitter', 'family']),
  phone: z.string().optional(),
  notes: z.string().optional(),
});

const clinicSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['primary', 'emergency', 'poison_control']),
  phone: z.string(),
  address: z.string().optional(),
  hours: z.string().optional(),
  url: z.string().optional(),
  notes: z.string().optional(),
});

const scheduleSlotSchema = z.object({
  id: z.string(),
  time: z.string(),
  label: z.string().optional(),
});

const MEDICATION_ROUTES = ['oral', 'topical', 'transdermal', 'inhalation', 'injection'] as const;
const medicationRoute = z.enum(MEDICATION_ROUTES);

const medicationViewSchema = z.object({
  id: z.string(),
  petId: z.string(),
  petName: z.string(),
  name: z.string(),
  strength: z.string().optional(),
  form: z.string().optional(),
  doseLabel: z.string(),
  route: medicationRoute,
  schedule: z.array(scheduleSlotSchema),
  scheduleLabel: z.string(),
  status: z.enum(['active', 'paused', 'stopped', 'prn']),
  startedOn: z.string(),
  stoppedOn: z.string().optional(),
  stopReason: z.string().optional(),
  prescriber: z.string().optional(),
  notes: z.string().optional(),
});

const careSlotSchema = z.object({
  petId: z.string(),
  petName: z.string(),
  medicationId: z.string(),
  medicationName: z.string(),
  strength: z.string().optional(),
  doseLabel: z.string(),
  slotId: z.string().optional(),
  scheduledTime: z.string(),
  scheduledFor: z.string(),
  status: z.enum(['taken', 'skipped', 'missed', 'due', 'upcoming']),
  recordedAt: z.string().optional(),
  recordedBy: z.string().optional(),
});

const careSummarySchema = z.object({
  day: z.string(),
  pet: z.string(),
  taken: z.number(),
  skipped: z.number(),
  missed: z.number(),
  due: z.number(),
  upcoming: z.number(),
  slots: z.array(careSlotSchema),
  prn: z.array(
    z.object({
      petName: z.string(),
      medicationName: z.string(),
      strength: z.string().optional(),
      doseLabel: z.string(),
      instructions: z.string(),
    }),
  ),
  asOf: z.string(),
});

const careLogSchema = z.object({
  id: z.string(),
  petId: z.string(),
  kind: z.enum(['medication', 'symptom', 'weight', 'note']),
  medicationId: z.string().optional(),
  slotId: z.string().optional(),
  day: z.string(),
  scheduledTime: z.string().optional(),
  status: z.enum(['taken', 'skipped', 'missed']).optional(),
  symptom: z.string().optional(),
  severity: z.enum(['mild', 'moderate', 'severe']).optional(),
  valueKg: z.number().optional(),
  note: z.string().optional(),
  recordedAt: z.string(),
  recordedBy: z.string(),
});

const outboxSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  channel: z.enum(['sms', 'email', 'voice']),
  to: z.string(),
  body: z.string(),
  status: z.enum(['queued', 'sent', 'failed']),
  sentAt: z.string().optional(),
  error: z.string().optional(),
  createdBy: z.string(),
});

const evidenceSchema = z.object({
  source: z.enum(['curated', 'record', 'symptom']),
  publisher: z.string().optional(),
  title: z.string().optional(),
  url: z.string().optional(),
  quote: z.string().optional(),
  accessed: z.string().optional(),
});

const findingSchema = z.object({
  severity: z.enum(['critical', 'urgent', 'watch', 'info']),
  title: z.string(),
  detail: z.string(),
  evidence: evidenceSchema,
});

const assessmentSchema = z.object({
  pet: z.object({
    id: z.string().optional(),
    name: z.string(),
    species: z.enum(['dog', 'cat', 'unknown']),
    weightKg: z.number().optional(),
  }),
  toxin: z.object({
    id: z.string(),
    name: z.string(),
    category: categorySchema,
    product: z.string().optional(),
  }),
  amount: z
    .object({
      value: z.number(),
      unit: amountUnitSchema,
      normalised: z.string().optional(),
    })
    .optional(),
  intent: z.enum(['ingested', 'considering']),
  verdict: verdictSchema,
  headline: z.string(),
  summary: z.string(),
  dosePerKg: z.number().optional(),
  doseUnit: z.string().optional(),
  threshold: z.object({ at: z.number(), label: z.string(), verdict: verdictSchema, detail: z.string().optional() }).optional(),
  nextThreshold: z.object({ at: z.number(), label: z.string(), verdict: verdictSchema }).optional(),
  scale: z.array(z.object({ at: z.number(), label: z.string(), verdict: verdictSchema })).optional(),
  anyAmountRule: z.boolean().optional(),
  escalation: z.object({ reason: z.string(), from: verdictSchema, to: verdictSchema }).optional(),
  findings: z.array(findingSchema),
  signs: z.array(z.string()),
  firstAid: z.array(z.string()),
  contacts: z.object({
    primary: z.object({ name: z.string(), phone: z.string(), hours: z.string().optional() }).optional(),
    emergency: z.object({ name: z.string(), phone: z.string(), address: z.string().optional() }).optional(),
    poisonControl: z.object({ name: z.string(), phone: z.string(), note: z.string().optional() }),
  }),
  assumptions: z.array(z.string()),
  limitations: z.array(z.string()),
  checkedAt: z.string(),
  latencyMs: z.number(),
});

/* ------------------------------------------------------------------ *
 * Errors and result helpers
 * ------------------------------------------------------------------ */

function toolError(error: unknown) {
  const message =
    error instanceof ScopeError || error instanceof ConfirmationError || error instanceof CareError
      ? error.message
      : `Something went wrong: ${(error as Error).message}`;
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function capitalizeFirst(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

/* ------------------------------------------------------------------ *
 * Domain helpers
 * ------------------------------------------------------------------ */

function contactsFor(db: Database): ExposureContacts {
  const poisonControl = db.clinics.find((clinic) => clinic.id === 'apcc') ?? db.clinics.find((clinic) => clinic.kind === 'poison_control');
  if (!poisonControl) throw new CareError('No poison-control clinic is on file. Add one before assessing exposures.');
  return {
    ...(db.clinics.find((clinic) => clinic.kind === 'primary') ? { primary: db.clinics.find((clinic) => clinic.kind === 'primary')! } : {}),
    ...(db.clinics.find((clinic) => clinic.kind === 'emergency')
      ? { emergency: db.clinics.find((clinic) => clinic.kind === 'emergency')! }
      : {}),
    poisonControl,
  };
}

function requirePet(db: Database, needle: string): Pet {
  const pet = findPet(db, needle);
  if (!pet) {
    throw new CareError(`No pet matching “${needle}” is on file. Pets on this account: ${db.pets.map((entry) => entry.name).join(', ')}.`);
  }
  return pet;
}

function resolveObservedAt(raw: string | undefined): string {
  if (!raw) return now().toISOString();
  if (/^\d{2}:\d{2}$/.test(raw)) {
    if (!timePattern.test(raw)) throw new CareError(`“${raw}” is not a valid 24-hour time. Use HH:MM, for example 21:40.`);
    return atLocalTime(todayKey(), raw);
  }
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    throw new CareError(`“${raw}” is not a time I can read. Use an ISO timestamp or HH:MM.`);
  }
  return new Date(parsed).toISOString();
}

function describeMedication(db: Database, medication: Medication) {
  const pet = db.pets.find((entry) => entry.id === medication.petId);
  return {
    id: medication.id,
    petId: medication.petId,
    petName: pet?.name ?? 'Unknown pet',
    name: medication.name,
    ...(medication.strength ? { strength: medication.strength } : {}),
    ...(medication.form ? { form: medication.form } : {}),
    doseLabel: medication.doseLabel,
    route: medication.route,
    schedule: medication.schedule.map((slot) => ({
      id: slot.id,
      time: slot.time,
      ...(slot.label ? { label: slot.label } : {}),
    })),
    scheduleLabel: medication.schedule.length > 0 ? medication.schedule.map((slot) => slot.time).join(', ') : 'as needed',
    status: medication.status,
    startedOn: medication.startedOn,
    ...(medication.stoppedOn ? { stoppedOn: medication.stoppedOn } : {}),
    ...(medication.stopReason ? { stopReason: medication.stopReason } : {}),
    ...(prescriberName(db, medication) ? { prescriber: prescriberName(db, medication)! } : {}),
    ...(medication.notes ? { notes: medication.notes } : {}),
  };
}

function renderCareText(summary: CareSummary): string {
  const lines = [
    `Care for ${summary.pet} on ${summary.day} (as of ${formatTime(summary.asOf)}).`,
    `${summary.taken} taken, ${summary.skipped} skipped, ${summary.missed} missed, ${summary.due} due now, ${summary.upcoming} upcoming.`,
  ];

  const pending = summary.slots.filter((slot) => slot.status !== 'taken' && slot.status !== 'skipped');
  if (pending.length > 0) {
    lines.push('', 'Still to do:');
    for (const slot of pending) {
      lines.push(
        `- ${formatTime(slot.scheduledFor)} ${slot.petName}: ${slot.medicationName}${slot.strength ? ` ${slot.strength}` : ''} — ${slot.status}`,
      );
    }
  }

  const done = summary.slots.filter((slot) => slot.status === 'taken' || slot.status === 'skipped');
  if (done.length > 0) {
    lines.push('', 'Already handled:');
    for (const slot of done) {
      lines.push(
        `- ${formatTime(slot.scheduledFor)} ${slot.petName}: ${slot.medicationName}${slot.strength ? ` ${slot.strength}` : ''} — ${slot.status}`,
      );
    }
  }

  if (summary.prn.length > 0) {
    lines.push('', 'As needed:');
    for (const item of summary.prn) {
      lines.push(`- ${item.petName}: ${item.medicationName}${item.strength ? ` ${item.strength}` : ''} — ${item.instructions}`);
    }
  }

  return lines.join('\n');
}

function renderHouseholdText(db: Database): string {
  const owner = db.people.find((person) => person.id === db.household.ownerId);
  const lines = [
    `${db.household.name}${db.household.address ? ` — ${db.household.address}` : ''} (${db.household.timezone}).`,
    `People: ${db.people.map((person) => `${person.name} (${person.role})`).join(', ')}.`,
    owner ? `Owner: ${owner.name}.` : '',
    '',
    'Pets:',
    ...db.pets.map(
      (pet) =>
        `- ${pet.name}: ${pet.ageYears}-year-old ${pet.sex} ${pet.breed}, ${pet.weightKg} kg. ${pet.conditions.join(', ') || 'No conditions recorded'}.`,
    ),
    '',
    'Care team:',
    ...db.clinics.map(
      (clinic) => `- ${clinic.name} (${clinic.kind.replaceAll('_', ' ')}): ${clinic.phone}${clinic.hours ? ` — ${clinic.hours}` : ''}`,
    ),
  ];
  return lines.filter((line, index) => line.length > 0 || index < lines.length - 1).join('\n');
}

function renderPetText(db: Database, pet: Pet, care: CareSummary): string {
  const medications = listMedications(db, { petId: pet.id, status: 'all' }).map((medication) => describeMedication(db, medication));
  const lines = [
    `${pet.name} — ${pet.breed}, ${pet.sex}, ${pet.neutered ? 'neutered' : 'not neutered'}, ${pet.ageYears} years old.`,
    `Species: ${pet.species}. Weight: ${pet.weightKg} kg (recorded ${pet.weightUpdatedAt.slice(0, 10)}).`,
    `Conditions: ${pet.conditions.join(', ') || 'none recorded'}.`,
    `Allergies: ${pet.allergies.map((allergy) => `${allergy.substance} (${allergy.reaction})`).join(', ') || 'none recorded'}.`,
    pet.diet ? `Diet: ${pet.diet}.` : '',
    pet.notes ? `Notes: ${pet.notes}.` : '',
    '',
    medications.length > 0 ? 'Medications:' : 'No medications on file.',
    ...medications.map(
      (medication) =>
        `- ${medication.name}${medication.strength ? ` ${medication.strength}` : ''} — ${medication.doseLabel} at ${medication.scheduleLabel} (${medication.status})${medication.stopReason ? `: ${medication.stopReason}` : ''}`,
    ),
    '',
    `Today: ${care.taken} taken, ${care.missed} missed, ${care.due} due now, ${care.upcoming} upcoming.`,
  ];
  return lines.filter((line, index) => line.length > 0 || index === 6 || index === 8).join('\n');
}

function unknownSubstanceAssessment(options: {
  pet: Pet;
  substance: string;
  amount?: { value: number; unit: AmountUnit };
  intent: 'ingested' | 'considering';
  symptoms: Symptom[];
  contacts: ExposureContacts;
  latencyMs: number;
}): ExposureAssessment {
  const { pet, substance, amount, intent, symptoms, contacts, latencyMs } = options;
  const findings: ExposureFinding[] = [];

  let verdict: Verdict = 'unverified';
  for (const symptom of symptoms) {
    if (SEVERE_SYMPTOMS.has(symptom)) verdict = 'emergency';
    else if (MODERATE_SYMPTOMS.has(symptom) && verdict !== 'emergency') verdict = 'call_vet';
  }

  const headline =
    verdict === 'emergency'
      ? `${pet.name} is showing emergency signs. Go now.`
      : `I don’t have a verified toxicosis record for “${substance}”.`;

  const summary =
    verdict === 'emergency'
      ? `A reported emergency sign overrides the missing substance record. Call ${contacts.emergency?.name ?? 'your emergency veterinarian'}${contacts.emergency ? ` at ${contacts.emergency.phone}` : ''} now.`
      : `Vetwise has no curated threshold for that substance, so this is an unverified answer — not a safe one. Call ${contacts.poisonControl.name} at ${contacts.poisonControl.phone} before you decide what to do.`;

  findings.push({
    severity: verdict === 'emergency' ? 'critical' : 'urgent',
    title: 'Substance is not in the curated catalogue',
    detail: `Vetwise carries ${TOXIN_COUNT} verified substances. “${substance}” is not one of them, so no dose can be cleared or escalated safely.`,
    evidence: {
      source: 'record',
      quote: `“${substance}” did not match any of the ${TOXIN_COUNT} curated toxicosis records.`,
    },
  });

  if (symptoms.length > 0) {
    findings.push({
      severity: verdict === 'emergency' ? 'critical' : 'urgent',
      title: 'Reported signs raise the response',
      detail: `Caregiver reported: ${symptoms.join(', ').replaceAll('_', ' ')}. Signs are triaged even when the substance is unknown.`,
      evidence: { source: 'symptom', quote: `Reported signs: ${symptoms.join(', ')}.` },
    });
  }

  const contactsOut = {
    ...(contacts.primary
      ? {
          primary: {
            name: contacts.primary.name,
            phone: contacts.primary.phone,
            ...(contacts.primary.hours ? { hours: contacts.primary.hours } : {}),
          },
        }
      : {}),
    ...(contacts.emergency
      ? {
          emergency: {
            name: contacts.emergency.name,
            phone: contacts.emergency.phone,
            ...(contacts.emergency.address ? { address: contacts.emergency.address } : {}),
          },
        }
      : {}),
    poisonControl: {
      name: contacts.poisonControl.name,
      phone: contacts.poisonControl.phone,
      ...(contacts.poisonControl.notes ? { note: contacts.poisonControl.notes } : {}),
    },
  };

  return {
    pet: {
      id: pet.id,
      name: pet.name,
      species: pet.species,
      ...(pet.weightKg > 0 ? { weightKg: pet.weightKg } : {}),
    },
    toxin: {
      id: 'unknown',
      name: substance,
      category: 'unknown',
    },
    ...(amount ? { amount: { value: amount.value, unit: amount.unit } } : {}),
    intent,
    verdict,
    headline,
    summary,
    findings,
    signs: ['vomiting', 'diarrhea', 'lethargy', 'drooling', 'tremors', 'seizures', 'difficulty breathing', 'collapse'],
    firstAid: [
      'Keep the substance, its packaging, or a clear photo of the label.',
      'Move your pet away from the substance and keep them calm.',
      'Do not induce vomiting unless a veterinarian or poison control tells you to.',
      `Call ${contacts.poisonControl.name} at ${contacts.poisonControl.phone} or your veterinarian now.`,
    ],
    contacts: contactsOut,
    assumptions: [
      ...(pet.weightKg > 0 ? [`Weight used: ${pet.weightKg} kg.`] : []),
      'Signs are caregiver-reported, not a veterinary examination.',
      'No threshold was calculated because the substance has no curated record.',
    ],
    limitations: [
      'This is a triage aid, not a diagnosis. A veterinarian who examines the pet may reach a different conclusion.',
      'An unknown substance is unverified, never reassuring. Absence of a record is not evidence of safety.',
      'Vetwise does not advise inducing vomiting or give any home treatment.',
    ],
    checkedAt: now().toISOString(),
    latencyMs,
  };
}

/* ------------------------------------------------------------------ *
 * Tool registration
 * ------------------------------------------------------------------ */

export function registerTools(server: McpServer, store: Store): void {
  /* ---------------------------------------------------------------- *
   * 1. get_household
   * ---------------------------------------------------------------- */
  server.registerTool(
    'get_household',
    {
      title: 'Household profile',
      description:
        'Read the household: people and their roles, every pet with species, weight and conditions, and the primary, emergency and poison-control clinics. Use this before answering any pet-safety question.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: z.object({}),
      outputSchema: z.object({
        household: z.object({
          id: z.string(),
          name: z.string(),
          timezone: z.string(),
          address: z.string().optional(),
          ownerId: z.string(),
          sitterIds: z.array(z.string()),
        }),
        people: z.array(personSchema),
        pets: z.array(petSchema),
        clinics: z.array(clinicSchema),
        asOf: z.string(),
      }),
    },
    async (_args, ctx: ServerContext) => {
      try {
        requireScope(ctx, SCOPES.read);
        const data = store.read((db) => ({
          household: db.household,
          people: db.people,
          pets: db.pets,
          clinics: db.clinics,
          asOf: now().toISOString(),
        }));
        return { content: [{ type: 'text', text: renderHouseholdText(store.read((db) => db)) }], structuredContent: data };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  /* ---------------------------------------------------------------- *
   * 2. get_pet
   * ---------------------------------------------------------------- */
  server.registerTool(
    'get_pet',
    {
      title: 'One pet',
      description:
        'Read one pet by name or id: breed, age, current weight, conditions, allergies, every medication including stopped ones, and today’s care status. Weight matters for every toxicosis calculation.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: z.object({ pet: z.string().describe('Pet name or id, for example "Mochi"') }),
      outputSchema: z.object({
        pet: petSchema,
        medications: z.array(medicationViewSchema),
        care: careSummarySchema,
      }),
    },
    async ({ pet: petNeedle }, ctx: ServerContext) => {
      try {
        requireScope(ctx, SCOPES.read);
        const data = store.read((db) => {
          const pet = requirePet(db, petNeedle);
          const care = careSummary(db, todayKey(), pet.id);
          return {
            pet,
            medications: listMedications(db, { petId: pet.id, status: 'all' }).map((medication) => describeMedication(db, medication)),
            care,
          };
        });
        return {
          content: [{ type: 'text', text: renderPetText(store.read((db) => db), data.pet, data.care) }],
          structuredContent: data,
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  /* ---------------------------------------------------------------- *
   * 3. get_care_summary
   * ---------------------------------------------------------------- */
  server.registerTool(
    'get_care_summary',
    {
      title: 'Today’s care',
      description:
        'Report which scheduled doses were taken, skipped, missed, are due now, or are still upcoming on a given day. Use this for any question about whether a pet had its medication. The day must be a real YYYY-MM-DD date.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: z.object({
        pet: z.string().optional().describe('Optional pet name or id; omit for every pet'),
        day: z.string().optional().describe('YYYY-MM-DD, defaults to today'),
      }),
      outputSchema: careSummarySchema,
    },
    async ({ pet: petNeedle, day }, ctx: ServerContext) => {
      try {
        requireScope(ctx, SCOPES.read);
        if (day !== undefined && !isDayKey(day)) {
          throw new CareError(`“${day}” is not a real calendar date. Use YYYY-MM-DD, for example ${todayKey()}.`);
        }
        const data = store.read((db) => {
          const pet = petNeedle ? requirePet(db, petNeedle) : undefined;
          return careSummary(db, day ?? todayKey(), pet?.id);
        });
        return { content: [{ type: 'text', text: renderCareText(data) }], structuredContent: data };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  /* ---------------------------------------------------------------- *
   * 4. list_medications
   * ---------------------------------------------------------------- */
  server.registerTool(
    'list_medications',
    {
      title: 'List medications',
      description:
        'List medications with strength, dose, schedule, status and prescriber. Defaults to active and as-needed medicines. Pass status "all" to include stopped medicines — "all" really means every status. Filter by pet when the household has more than one.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: z.object({
        pet: z.string().optional().describe('Optional pet name or id'),
        status: z.enum(['active', 'all', 'stopped', 'prn']).optional().describe('Defaults to active'),
      }),
      outputSchema: z.object({
        pet: z.string(),
        status: z.enum(['active', 'all', 'stopped', 'prn']),
        medications: z.array(medicationViewSchema),
      }),
    },
    async ({ pet: petNeedle, status = 'active' }, ctx: ServerContext) => {
      try {
        requireScope(ctx, SCOPES.read);
        const data = store.read((db) => {
          const pet = petNeedle ? requirePet(db, petNeedle) : undefined;
          return {
            pet: pet?.name ?? 'All pets',
            status,
            medications: listMedications(db, { status, ...(pet ? { petId: pet.id } : {}) }).map((medication) =>
              describeMedication(db, medication),
            ),
          };
        });

        const text =
          data.medications.length === 0
            ? `No ${status === 'all' ? '' : `${status} `}medications are on file for ${data.pet}.`
            : `${data.pet} — ${data.medications.length} ${status === 'all' ? 'medication' : `${status} medication`}${data.medications.length === 1 ? '' : 's'}:\n` +
              data.medications
                .map(
                  (medication) =>
                    `- ${medication.name}${medication.strength ? ` ${medication.strength}` : ''} — ${medication.doseLabel} at ${medication.scheduleLabel} (${medication.status})${
                      medication.prescriber ? `; ${medication.prescriber}` : ''
                    }${medication.stopReason ? `. Stopped: ${medication.stopReason}` : ''}`,
                )
                .join('\n');
        return { content: [{ type: 'text', text }], structuredContent: data };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  /* ---------------------------------------------------------------- *
   * 5. assess_toxin_exposure
   * ---------------------------------------------------------------- */
  server.registerTool(
    'assess_toxin_exposure',
    {
      title: 'Assess a toxin exposure',
      description:
        'The safety engine. Given a pet, a substance, and whatever is known about the amount, product and signs, return one of five verdicts with dose math and cited veterinary evidence. Unknown weight, amount, species or product returns "unverified", never reassurance. Grapes, lilies, rodenticide and antifreeze escalate on any exposure. This tool never advises treatment or inducing vomiting; it names the vet and poison-control numbers.',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      inputSchema: z.object({
        pet: z.string().describe('Pet name or id'),
        substance: z.string().describe('What the pet got into, for example "chocolate", "grapes", "lily" or "ibuprofen"'),
        amountValue: z.number().positive().optional().describe('Amount eaten; pair with amountUnit'),
        amountUnit: amountUnitSchema.optional().describe('Unit for amountValue'),
        product: z.string().optional().describe('Product detail, for example "65% cocoa dark chocolate bar" or "sugar-free gum"'),
        intent: z.enum(['ingested', 'considering']).optional().describe('Defaults to ingested; use considering for "can I give this?"'),
        symptoms: z.array(symptomSchema).optional().describe('Signs the caregiver has actually seen'),
        observedAt: z.string().optional().describe('When it happened: ISO timestamp or HH:MM'),
        note: z.string().optional(),
      }),
      outputSchema: assessmentSchema.extend({
        exposureId: z.string().optional(),
        recorded: z.boolean(),
      }),
    },
    async (args, ctx: ServerContext) => {
      try {
        const caller = requireScope(ctx, SCOPES.read);
        if (args.amountValue !== undefined && args.amountUnit === undefined) {
          throw new CareError('Tell me the unit for that amount — for example 40 g, 2 pieces, or 200 mg.');
        }
        if (args.amountUnit !== undefined && args.amountValue === undefined) {
          throw new CareError('Tell me how much, not just the unit.');
        }

        const intent = args.intent ?? 'ingested';
        const symptoms = (args.symptoms ?? []) as Symptom[];
        const observedAt = resolveObservedAt(args.observedAt);
        const startedAt = performance.now();

        const { pet, toxin, assessment } = store.read((db) => {
          const pet = requirePet(db, args.pet);
          const contacts = contactsFor(db);
          const toxin = findToxin(args.substance);

          const assessment = toxin
            ? assessExposure({
                pet,
                toxin,
                ...(args.product ? { productText: args.product } : {}),
                ...(args.amountValue !== undefined && args.amountUnit !== undefined
                  ? { amount: { value: args.amountValue, unit: args.amountUnit } }
                  : {}),
                intent,
                symptoms,
                contacts,
              })
            : unknownSubstanceAssessment({
                pet,
                substance: args.substance,
                ...(args.amountValue !== undefined && args.amountUnit !== undefined
                  ? { amount: { value: args.amountValue, unit: args.amountUnit } }
                  : {}),
                intent,
                symptoms,
                contacts,
                latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
              });

          return { pet, toxin, assessment };
        });

        let exposureId: string | undefined;
        let recorded = false;
        const canLog = caller.scopes.includes(SCOPES.log);

        if (canLog) {
          exposureId = newId('exp');
          const exposure: Exposure = {
            id: exposureId,
            petId: pet.id,
            toxinId: toxin?.id ?? 'unknown',
            toxinName: toxin?.name ?? args.substance,
            ...(args.product ? { product: args.product } : assessment.toxin.product ? { product: assessment.toxin.product } : {}),
            ...(args.amountValue !== undefined && args.amountUnit !== undefined
              ? { amountValue: args.amountValue, amountUnit: args.amountUnit }
              : {}),
            observedAt,
            reportedAt: now().toISOString(),
            verdict: assessment.verdict,
            headline: assessment.headline,
            ...(assessment.dosePerKg !== undefined ? { dosePerKg: assessment.dosePerKg } : {}),
            ...(assessment.doseUnit ? { doseUnit: assessment.doseUnit } : {}),
            symptoms,
            status: 'reported',
            ...(args.note ? { note: args.note } : {}),
            assessedBy: caller.clientId,
          };

          await store.mutate((db) => {
            db.exposures.unshift(exposure);
            audit(
              db,
              caller.clientId,
              'exposure.assessed',
              `${pet.name}: ${exposure.toxinName} — ${assessment.verdict.toUpperCase()} (${assessment.headline})`,
            );
          });
          recorded = true;
        }

        const text = [
          renderAssessment(assessment),
          '',
          recorded
            ? `Recorded as exposure ${exposureId} by ${callerLabel(caller.clientId)}.`
            : 'Not recorded: this token has read-only access.',
        ].join('\n');

        return {
          content: [{ type: 'text', text }],
          structuredContent: {
            ...assessment,
            ...(exposureId ? { exposureId } : {}),
            recorded,
          },
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  /* ---------------------------------------------------------------- *
   * 6. log_care_event
   * ---------------------------------------------------------------- */
  server.registerTool(
    'log_care_event',
    {
      title: 'Log a care event',
      description:
        'Record a medication as taken or skipped, a symptom, a weight, or a note. Medication logging requires an unambiguous slot: if a medicine has two unlogged doses today, supply scheduledTime. This tool never guesses which dose was given.',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      inputSchema: z.object({
        pet: z.string().describe('Pet name or id'),
        kind: z.enum(['medication', 'symptom', 'weight', 'note']),
        medication: z.string().optional().describe('Medication name or id; required for kind=medication'),
        scheduledTime: z.string().optional().describe('HH:MM slot, needed when more than one dose is unlogged'),
        status: z.enum(['taken', 'skipped']).optional().describe('Defaults to taken'),
        symptom: z
          .enum([
            'vomiting',
            'diarrhea',
            'lethargy',
            'tremors',
            'seizure',
            'collapse',
            'difficulty_breathing',
            'drooling',
            'abdominal_pain',
          ])
          .optional(),
        severity: z.enum(['mild', 'moderate', 'severe']).optional(),
        weightKg: z.number().positive().optional(),
        note: z.string().optional(),
        day: z.string().optional().describe('YYYY-MM-DD, defaults to today'),
      }),
      outputSchema: z.object({
        message: z.string(),
        event: careLogSchema,
        updatedPet: petSchema.optional(),
      }),
    },
    async (args, ctx: ServerContext) => {
      try {
        const caller = requireScope(ctx, SCOPES.log);
        if (args.day !== undefined && !isDayKey(args.day)) {
          throw new CareError(`“${args.day}” is not a real calendar date. Use YYYY-MM-DD.`);
        }

        const result = await store.mutate((db) => {
          const pet = requirePet(db, args.pet);
          const medication =
            args.kind === 'medication'
              ? args.medication
                ? findMedication(db, args.medication, pet.id)
                : undefined
              : undefined;

          if (args.kind === 'medication' && !medication) {
            throw new CareError(
              args.medication
                ? `No medication matching “${args.medication}” is on ${pet.name}’s record.`
                : 'Tell me which medication to log.',
            );
          }

          return logCareEvent(db, {
            petId: pet.id,
            kind: args.kind,
            ...(medication ? { medicationId: medication.id } : {}),
            ...(args.scheduledTime ? { scheduledTime: args.scheduledTime } : {}),
            ...(args.status ? { status: args.status } : {}),
            ...(args.symptom ? { symptom: args.symptom } : {}),
            ...(args.severity ? { severity: args.severity } : {}),
            ...(args.weightKg !== undefined ? { valueKg: args.weightKg } : {}),
            ...(args.note ? { note: args.note } : {}),
            ...(args.day ? { day: args.day } : {}),
            actor: caller.clientId,
          });
        });

        return {
          content: [{ type: 'text', text: result.message }],
          structuredContent: {
            message: result.message,
            event: result.event,
            ...(result.updatedPet ? { updatedPet: result.updatedPet } : {}),
          },
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  /* ---------------------------------------------------------------- *
   * 7. propose_record_change
   * ---------------------------------------------------------------- */
  server.registerTool(
    'propose_record_change',
    {
      title: 'Propose a record change',
      description:
        'Phase one of a two-phase record change. Prepare stopping, pausing, resuming or adding a medication, or recording a new weight. Returns a single-use confirmation token bound to this caregiver. Nothing changes until apply_record_change presents that token. Always read the summary back and get an explicit yes before applying.',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      inputSchema: z.object({
        action: z.enum(RECORD_CHANGE_ACTIONS),
        pet: z.string().describe('Pet name or id'),
        medication: z.string().optional().describe('Medication name or id; required for stop, pause and resume'),
        reason: z.string().optional().describe('Why the medication is being stopped or paused'),
        name: z.string().optional().describe('Medication name; required for action=medication.add'),
        strength: z.string().optional(),
        doseLabel: z.string().optional().describe('Plain-language dose, for example "1/2 tablet"'),
        route: medicationRoute
          .optional()
          .describe('Administration route; required for action=medication.add (defaults to oral)'),
        scheduleTimes: z.array(z.string()).optional().describe('HH:MM times for a new medication'),
        weightKg: z.number().positive().optional().describe('New weight; required for action=pet.weight'),
        note: z.string().optional(),
      }),
      outputSchema: z.object({
        token: z.string(),
        expiresAt: z.string(),
        action: z.enum(RECORD_CHANGE_ACTIONS),
        summary: z.string(),
        requiresConfirmation: z.literal(true),
      }),
    },
    async (args, ctx: ServerContext) => {
      try {
        const caller = requireScope(ctx, SCOPES.write);

        const proposal = store.read((db) => {
          const pet = requirePet(db, args.pet);

          if (args.action === 'pet.weight') {
            if (args.weightKg === undefined) throw new CareError(`Tell me ${pet.name}’s new weight in kilograms.`);
            if (args.weightKg > 120) throw new CareError('That weight looks like a typo. Vetwise accepts weights up to 120 kg.');
            return {
              payload: { petId: pet.id, weightKg: args.weightKg, ...(args.note ? { note: args.note } : {}) },
              summary: `Record ${pet.name}’s weight as ${args.weightKg} kg${args.note ? ` (${args.note})` : ''}.`,
            };
          }

          if (args.action === 'medication.add') {
            if (!args.name || !args.doseLabel) throw new CareError('A new medication needs a name and a plain-language dose.');
            if (!args.scheduleTimes || args.scheduleTimes.length === 0) {
              throw new CareError('A new scheduled medication needs at least one HH:MM time.');
            }
            const times: string[] = [];
            for (const time of args.scheduleTimes) {
              if (!timePattern.test(time)) throw new CareError(`“${time}” is not a valid 24-hour time. Use HH:MM.`);
              if (!times.includes(time)) times.push(time);
            }
            const schedule = times.map((time) => ({ id: newId('slot'), time }));
            return {
              payload: {
                petId: pet.id,
                name: args.name,
                ...(args.strength ? { strength: args.strength } : {}),
                doseLabel: args.doseLabel,
                route: args.route ?? 'oral',
                schedule,
                ...(args.note ? { notes: args.note } : {}),
              },
              summary: `Add ${args.name}${args.strength ? ` ${args.strength}` : ''} for ${pet.name}: ${args.doseLabel} ${args.route ?? 'oral'}, ${times.join(' and ')}.`,
            };
          }

          if (!args.medication) throw new CareError(`Tell me which of ${pet.name}’s medications to ${args.action.split('.')[1]}.`);
          const medication = findMedication(db, args.medication, pet.id);
          if (!medication) throw new CareError(`No medication matching “${args.medication}” is on ${pet.name}’s record.`);

          const label = `${medication.name}${medication.strength ? ` ${medication.strength}` : ''}`;
          const verb = args.action === 'medication.stop' ? 'Stop' : args.action === 'medication.pause' ? 'Pause' : 'Resume';
          return {
            payload: {
              petId: pet.id,
              medicationId: medication.id,
              medicationName: label,
              ...(args.reason ? { reason: args.reason } : {}),
            },
            summary: `${verb} ${label} for ${pet.name}${args.reason ? ` — ${args.reason}` : ''}.`,
          };
        });

        const { token, expiresAt } = await mintConfirmation(store, {
          action: args.action,
          payload: proposal.payload,
          clientId: caller.clientId,
        });

        await store.mutate((db) => {
          audit(db, caller.clientId, 'confirmation.proposed', `${args.action}: ${proposal.summary}`);
        });

        const text = [
          'CONFIRMATION REQUIRED — nothing has changed yet.',
          proposal.summary,
          '',
          `Read that back to ${callerLabel(caller.clientId)} and ask for an explicit yes.`,
          'If they say yes, call apply_record_change with the token from structuredContent — do not read the token aloud.',
          `The code expires in ${Math.max(1, Math.round((Date.parse(expiresAt) - Date.now()) / 60_000))} minutes.`,
        ].join('\n');

        return {
          content: [{ type: 'text', text }],
          structuredContent: {
            token,
            expiresAt,
            action: args.action,
            summary: proposal.summary,
            requiresConfirmation: true as const,
          },
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  /* ---------------------------------------------------------------- *
   * 8. apply_record_change
   * ---------------------------------------------------------------- */
  const medicationRefPayload = z.object({
    petId: z.string(),
    medicationId: z.string(),
    medicationName: z.string(),
    reason: z.string().optional(),
  });

  const addMedicationPayload = z.object({
    petId: z.string(),
    name: z.string(),
    strength: z.string().optional(),
    doseLabel: z.string(),
    route: medicationRoute,
    schedule: z.array(z.object({ id: z.string(), time: z.string(), label: z.string().optional() })),
    notes: z.string().optional(),
  });

  const weightPayload = z.object({
    petId: z.string(),
    weightKg: z.number(),
    note: z.string().optional(),
  });

  function parsePayload<T>(schema: z.ZodType<T>, payload: unknown): T {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new ConfirmationError('That confirmation is malformed. Ask me to prepare the change again.');
    return parsed.data;
  }

  server.registerTool(
    'apply_record_change',
    {
      title: 'Apply a confirmed record change',
      description:
        'Phase two of a two-phase record change. Present the single-use token returned by propose_record_change. The token must belong to the same caregiver, must not be expired, and is marked used only after the change succeeds. Never call this without an explicit yes from the person.',
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      inputSchema: z.object({
        token: z.string().describe('The token returned by propose_record_change'),
      }),
      outputSchema: z.object({
        action: z.enum(RECORD_CHANGE_ACTIONS),
        summary: z.string(),
        updatedAt: z.string(),
      }),
    },
    async ({ token }, ctx: ServerContext) => {
      try {
        const caller = requireScope(ctx, SCOPES.write);
        const result = await applyConfirmation(store, token, {
          actions: [...RECORD_CHANGE_ACTIONS],
          clientId: caller.clientId,
          apply: (db, payload, action) => {
            if (action === 'pet.weight') {
              const data = parsePayload(weightPayload, payload);
              const pet = db.pets.find((entry) => entry.id === data.petId);
              if (!pet) throw new ConfirmationError('That pet is no longer on the record.');
              const recordedAt = now().toISOString();
              pet.weightKg = data.weightKg;
              pet.weightUpdatedAt = recordedAt;
              db.careLogs.push({
                id: newId('care'),
                petId: pet.id,
                kind: 'weight',
                day: todayKey(),
                valueKg: data.weightKg,
                ...(data.note ? { note: data.note } : {}),
                recordedAt,
                recordedBy: caller.clientId,
              });
              const summary = `${pet.name}’s weight is now ${data.weightKg} kg.`;
              audit(db, caller.clientId, 'record.weight', summary);
              return {
                action: action as (typeof RECORD_CHANGE_ACTIONS)[number],
                summary,
                updatedAt: recordedAt,
              };
            }

            if (action === 'medication.add') {
              const data = parsePayload(addMedicationPayload, payload);
              const pet = db.pets.find((entry) => entry.id === data.petId);
              if (!pet) throw new ConfirmationError('That pet is no longer on the record.');
              const medication: Medication = {
                id: newId('med'),
                petId: pet.id,
                name: data.name,
                ...(data.strength ? { strength: data.strength } : {}),
                doseLabel: data.doseLabel,
                route: data.route,
                schedule: data.schedule,
                status: 'active',
                startedOn: todayKey(),
                ...(data.notes ? { notes: data.notes } : {}),
                addedBy: caller.clientId,
              };
              db.medications.push(medication);
              const summary = `Added ${data.name}${data.strength ? ` ${data.strength}` : ''} for ${pet.name}: ${data.doseLabel}, ${data.schedule
                .map((slot) => slot.time)
                .join(' and ')}.`;
              audit(db, caller.clientId, 'record.medication.add', summary);
              return {
                action: action as (typeof RECORD_CHANGE_ACTIONS)[number],
                summary,
                updatedAt: now().toISOString(),
              };
            }

            const data = parsePayload(medicationRefPayload, payload);
            const medication = db.medications.find((entry) => entry.id === data.medicationId && entry.petId === data.petId);
            if (!medication) throw new ConfirmationError('That medication is no longer on the record.');

            if (action === 'medication.stop') {
              if (medication.status === 'stopped') throw new ConfirmationError(`${data.medicationName} is already stopped.`);
              medication.status = 'stopped';
              medication.stoppedOn = todayKey();
              if (data.reason) medication.stopReason = data.reason;
            } else if (action === 'medication.pause') {
              if (medication.status === 'paused') throw new ConfirmationError(`${data.medicationName} is already paused.`);
              medication.status = 'paused';
            } else if (action === 'medication.resume') {
              if (medication.status === 'active') throw new ConfirmationError(`${data.medicationName} is already active.`);
              medication.status = 'active';
              delete medication.stoppedOn;
              delete medication.stopReason;
            } else {
              throw new ConfirmationError('That confirmation belongs to an action this tool does not handle.');
            }

            const summary =
              action === 'medication.stop'
                ? `Stopped ${data.medicationName}${data.reason ? ` — ${data.reason}` : ''}.`
                : action === 'medication.pause'
                  ? `Paused ${data.medicationName}${data.reason ? ` — ${data.reason}` : ''}.`
                  : `Resumed ${data.medicationName}.`;
            audit(db, caller.clientId, `record.${action}`, summary);
            return {
              action: action as (typeof RECORD_CHANGE_ACTIONS)[number],
              summary,
              updatedAt: now().toISOString(),
            };
          },
        });

        return { content: [{ type: 'text', text: `Record updated — ${result.summary}` }], structuredContent: result };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  /* ---------------------------------------------------------------- *
   * 9. alert_caregiver
   * ---------------------------------------------------------------- */
  server.registerTool(
    'alert_caregiver',
    {
      title: 'Alert a caregiver',
      description:
        'Queue a short alert to a person in this household. Recipients are restricted to people on the household record; a phone number or outside contact is rejected. Use this to tell the owner what happened and what the vet said.',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      inputSchema: z.object({
        to: z.string().describe('Household member name, id, or phone number already on file'),
        channel: z.enum(['sms', 'email', 'voice']).optional().describe('Defaults to sms'),
        body: z.string().min(3).max(500).describe('Short message to deliver'),
      }),
      outputSchema: outboxSchema,
    },
    async ({ to, channel = 'sms', body }, ctx: ServerContext) => {
      try {
        const caller = requireScope(ctx, SCOPES.notify);
        const clean = sanitiseAlertBody(body);
        if (clean.length < 3) {
          throw new CareError('The alert body needs at least a few words of plain text — line breaks and markup are stripped.');
        }
        const person = store.read((db) => findPerson(db, to) ?? db.people.find((entry) => entry.phone === to));
        if (!person) {
          const allowed = store.read((db) => db.people.map((entry) => `${entry.name} (${entry.role})`).join(', '));
          throw new CareError(`I can only alert people in this household: ${allowed}. I will not send to an outside contact.`);
        }

        const item = await sendCaregiverAlert(store, {
          to: person.phone ?? person.name,
          body: clean,
          channel,
          actor: caller.clientId,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Queued ${channel} to ${person.name}${person.phone ? ` (${person.phone})` : ''}: “${item.body}”. Delivery status: ${item.status}.`,
            },
          ],
          structuredContent: item,
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
