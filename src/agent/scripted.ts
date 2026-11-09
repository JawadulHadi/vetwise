import type { Client } from '@modelcontextprotocol/client';
import { formatTime, now, todayKey } from '../clock.js';
import type { AmountUnit, ExposureAssessment, Symptom, Verdict } from '../domain/types.js';
import { TOXINS } from '../domain/toxins.js';
import { callTool, type AgentResult, type AgentStep } from './mcp.js';

/**
 * Deterministic demo agent.
 *
 * It is not a language model: it maps a handful of caregiver phrasings onto the
 * same MCP tools a real host would call, and it composes the spoken answer from
 * the tool's structured result. That keeps the recording reproducible and keeps
 * the MCP server — the thing being judged — on the critical path.
 *
 * Safety rule for this file: it may choose *which* tool to call and *how much*
 * of the message to pass along. It never decides a verdict. Every verdict,
 * threshold and citation comes back from `assess_toxin_exposure`.
 */

export interface ScriptedPet {
  name: string;
  species: 'dog' | 'cat';
  weightKg: number;
  /** Used to resolve "my corgi" when the caregiver does not say the pet's name. */
  breed?: string;
}

export interface ScriptedMedication {
  name: string;
  petName: string;
  times: string[];
}

export interface ScriptedContext {
  ownerName: string;
  sitterName: string;
  people: string[];
  pets: ScriptedPet[];
  medications: ScriptedMedication[];
  /** On-file poison control, so a dead end can still name a real number. */
  poisonControl?: { name: string; phone: string };
}

export interface ScriptedState {
  pendingToken?: string;
  pendingSummary?: string;
  lastToxin?: string;
  lastPet?: string;
  /** Arguments from the most recent assessment, so a symptom follow-up can be re-run. */
  lastExposure?: {
    pet: string;
    substance: string;
    intent: 'ingested' | 'considering';
    amountValue?: number;
    amountUnit?: AmountUnit;
    product?: string;
    symptoms: Symptom[];
  };
  lastReply?: string;
}

const YES = /^(yes|yeah|yep|yup|confirm|confirmed|do it|go ahead|ok|okay|sure|please do|that's right|correct)\b/i;
const NO = /^(no|nope|nah|cancel|stop|don't|do not|not now|never mind|nevermind)\b/i;

const GREETING =
  /\b(hi|hello|hey|good (morning|evening|afternoon)|what'?s due|whats due|check in|check-in|anything due|tonight|this evening|doses?|medications? due)\b/i;

const EXPOSURE_VERB =
  /\b(ate|eaten|eat|eating|got into|got in|licked|lick|drank|drink|chewed|chew|swallowed|ingested|tasted|taste|stole|grabbed|consumed|nibbled|munched|munch|snacked|snack|chowed|chow|gulped|gulp|scarfed|scarf|devoured|devour|snaffled|snaffle|bit|bite|found (him|her|them)? ?(with|near|in)|may have|might have|think .* (ate|got into)|got a ?hold of)\b/i;

const CONSIDERING = /\b(can|should|could|is it (ok|okay|safe)|would it be (ok|okay|safe)|safe|okay to|alright to)\b/i;

const HELP_WORDS = /\b(toxic|poison|danger|dangerous|risk|risky|bad for|safe for|harmful)\b/i;

const ALERT_VERB = /\b(text|message|alert|notify|tell|remind)\b/i;

/** "What did Mochi eat today?" — a read of the log, not a new assessment. */
const EXPOSURE_HISTORY_SUBJECT = /\b(what|anything|which|history|exposures?)\b/i;
const EXPOSURE_HISTORY_ACTIVITY =
  /\b(ate|eaten|eat|eating|got into|gotten into|get into|swallowed|ingested|been into|exposure|exposures)\b/i;
const EXPOSURE_HISTORY_TIME =
  /\b(today|yesterday|last night|this week|this month|recently|so far|history|record|logged|log|list|show)\b/i;

const STOP_WORDS = /\b(stop|stopped|discontinue|pause|paused|hold|resume|restart|start again|put .* back on)\b/i;

const WEIGHT_WORDS = /\b(weighs?|weighed|weighing|weight)\b/i;

const MED_LOG_VERB =
  /\b(gave|give|given|gave her|gave him|administered|dosed|logged?|took|takes|taking|skipped|missed|refused|didn'?t give|did not give)\b/i;

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  half: 0.5,
  couple: 2,
  few: 3,
  several: 3,
};

const UNIT_ALIASES: Array<{ pattern: string; unit: AmountUnit }> = [
  { pattern: 'milligrams?|mg', unit: 'mg' },
  { pattern: 'kilograms?|kg', unit: 'kg' },
  { pattern: 'grams?|grammes?|g', unit: 'g' },
  { pattern: 'ounces?|oz', unit: 'oz' },
  { pattern: 'millilit(?:er|re)s?|ml', unit: 'ml' },
  { pattern: 'teaspoons?|tsp', unit: 'tsp' },
  { pattern: 'tablespoons?|tbsp', unit: 'tbsp' },
  { pattern: 'squares?', unit: 'squares' },
  { pattern: 'bars?', unit: 'bars' },
  { pattern: 'tablets?|pills?|capsules?', unit: 'tablets' },
  { pattern: 'pieces?|cubes?|chunks?|slices?', unit: 'pieces' },
];

const SYMPTOM_WORDS: Array<{ pattern: RegExp; symptom: Symptom }> = [
  { pattern: /\b(vomit(?:ed|ing|s)?|threw up|throwing up|puked?)\b/i, symptom: 'vomiting' },
  { pattern: /\b(diarrh(?:ea|oea)|loose stool)\b/i, symptom: 'diarrhea' },
  { pattern: /\b(letharg(?:y|ic)|very tired|listless|weak(?:ness)?)\b/i, symptom: 'lethargy' },
  { pattern: /\b(tremors?|trembling|shaking|shaky)\b/i, symptom: 'tremors' },
  { pattern: /\b(seizure|seizing|convuls(?:ion|ing))\b/i, symptom: 'seizure' },
  { pattern: /\b(collaps(?:e|ed|ing)|passed out)\b/i, symptom: 'collapse' },
  { pattern: /\b(difficulty breathing|trouble breathing|can'?t breathe|labored breathing|gasping)\b/i, symptom: 'difficulty_breathing' },
  { pattern: /\b(drool(?:ing|s)?|hypersalivat\w*)\b/i, symptom: 'drooling' },
  { pattern: /\b(abdominal pain|belly pain|stomach ache|stomachache|painful belly)\b/i, symptom: 'abdominal_pain' },
];

interface AssessmentResult extends ExposureAssessment {
  exposureId?: string;
  recorded?: boolean;
}

function trim(text: string, max: number): string {
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length <= max ? value : `${value.slice(0, max).trim()}…`;
}

/**
 * Pull the caregiver's reason out of a record-change sentence without echoing
 * the command back. "Stop Mochi's carprofen — the vet said to" becomes
 * "the vet said to". If no reason is stated, no reason is invented.
 */
function reasonFrom(text: string): string | undefined {
  const afterDash = /(?:—|–|\s-\s)\s*(.+)$/.exec(text)?.[1];
  const afterBecause = /\b(?:because|since)\s+(.+)$/i.exec(text)?.[1];
  const candidate = afterDash ?? afterBecause;
  if (candidate) {
    const value = candidate.replace(/^[\s,;:.-]+/, '').replace(/[\s.]+$/, '').trim();
    if (value.length > 2) return trim(value, 160);
  }
  if (/\bvet\b/i.test(text) && /\b(?:said|told)\b/i.test(text)) return 'the vet said to';
  return undefined;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

function lower(value: string): string {
  return value.toLowerCase().replaceAll('’', "'");
}

function includesWord(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
}

function petFrom(context: ScriptedContext, text: string): ScriptedPet | undefined {
  const named = context.pets.find((pet) => includesWord(text, pet.name));
  if (named) return named;

  // "my corgi" / "the shorthair" - a breed token unique to one pet.
  const byBreed = context.pets.filter(
    (pet) =>
      pet.breed !== undefined &&
      pet.breed
        .toLowerCase()
        .split(/\s+/)
        .some((token) => token.length >= 4 && includesWord(text, token)),
  );
  if (byBreed.length === 1) return byBreed[0];

  // "my dog" / "the cat" - only when the household has exactly one of them.
  const species = /\b(dog|puppy|pup|doggo)\b/i.test(text) ? 'dog' : /\b(cat|kitten|kitty)\b/i.test(text) ? 'cat' : undefined;
  if (species) {
    const matches = context.pets.filter((pet) => pet.species === species);
    if (matches.length === 1) return matches[0];
  }

  return undefined;
}

function personFrom(context: ScriptedContext, text: string): string | undefined {
  for (const name of context.people) {
    if (includesWord(text, name)) return name;
    const first = name.split(/\s+/)[0]!;
    if (includesWord(text, first)) return name;
  }
  return undefined;
}

function medicationFrom(context: ScriptedContext, text: string): ScriptedMedication | undefined {
  return context.medications
    .slice()
    .sort((a, b) => b.name.length - a.name.length)
    .find((medication) => {
      const base = medication.name.replace(/\s*\(.*\)$/, '').trim();
      return includesWord(text, medication.name) || includesWord(text, base);
    });
}

/** Find the longest toxin alias present in the sentence. */
function toxinFrom(text: string): { alias: string; id: string; name: string } | undefined {
  let best: { alias: string; id: string; name: string } | undefined;
  for (const toxin of TOXINS) {
    for (const alias of toxin.aliases) {
      if (alias.length < 3) continue;
      if (!includesWord(text, alias)) continue;
      if (!best || alias.length > best.alias.length) best = { alias, id: toxin.id, name: toxin.name };
    }
  }
  return best;
}

/** The phrase after the ingestion verb, e.g. "trash" in "Mochi got into the trash". */
function substanceFrom(text: string, match: RegExpExecArray): string | undefined {
  const tail = text.slice(match.index + match[0].length).split(/[.,;!?]/)[0] ?? '';
  const cleaned = tail
    .replace(/\b(the|a|an|some|my|his|her|their|our|of|on|at|from|into)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return undefined;
  return cleaned.split(/\s+/).slice(0, 5).join(' ');
}

function productFrom(toxinId: string, text: string): string | undefined {
  const toxin = TOXINS.find((entry) => entry.id === toxinId);
  if (!toxin?.products) return undefined;
  let best: string | undefined;
  for (const product of toxin.products) {
    for (const alias of [product.label, ...product.aliases]) {
      if (alias.length < 3) continue;
      if (!includesWord(text, alias)) continue;
      if (!best || alias.length > best.length) best = alias;
    }
  }
  return best;
}

function symptomsFrom(text: string): Symptom[] {
  const found: Symptom[] = [];
  for (const entry of SYMPTOM_WORDS) {
    if (entry.pattern.test(text) && !found.includes(entry.symptom)) found.push(entry.symptom);
  }
  return found;
}

function normaliseNumbers(text: string): string {
  return text
    .replace(/\ba couple of\b/gi, '2')
    .replace(/\ba couple\b/gi, '2')
    .replace(/\ba few\b/gi, '3')
    .replace(/\bhalf (?:a|an)\b/gi, '0.5')
    .replace(/\bhalf of a\b/gi, '0.5')
    .replace(/\bhalf of an\b/gi, '0.5');
}

interface Amount {
  value: number;
  unit: AmountUnit;
}

function amountFrom(text: string): Amount | undefined {
  const prepared = normaliseNumbers(text);
  const numbers = '\\d+(?:\\.\\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|half|couple|few|several';

  for (const { pattern, unit } of UNIT_ALIASES) {
    const regex = new RegExp(`(?:^|[^a-z0-9])(${numbers})\\s*(?:${pattern})(?![a-z])`, 'i');
    const match = regex.exec(prepared);
    if (!match) continue;
    const raw = match[1]!.toLowerCase();
    const value = /^\d/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
    if (value === undefined || !Number.isFinite(value) || value <= 0) continue;
    return { value, unit };
  }
  return undefined;
}

/**
 * The engine wants a physical amount. A "square" of a 65% bar is about 10 g,
 * not the 100 g bar the product record describes, so the agent does that one
 * arithmetic step before handing over a mass. Everything safety-relevant still
 * happens server-side.
 */
function adjustForChocolate(toxinId: string, amount: Amount | undefined): Amount | undefined {
  if (toxinId !== 'chocolate' || !amount) return amount;
  if (amount.unit === 'squares') return { value: amount.value * 10, unit: 'g' };
  if (amount.unit === 'bars') return { value: amount.value * 100, unit: 'g' };
  return amount;
}

function timeFrom(text: string, medication?: ScriptedMedication): string | undefined {
  const clock = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text);
  if (clock) return `${clock[1]!.padStart(2, '0')}:${clock[2]!}`;

  const spoken = /\b(\d{1,2})\s*(a\.?m\.?|p\.?m\.?|o'?clock)\b/i.exec(text);
  if (spoken) {
    let hour = Number(spoken[1]);
    const marker = spoken[2]!.toLowerCase().replaceAll('.', '');
    if (marker.startsWith('p') && hour < 12) hour += 12;
    if (marker.startsWith('a') && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23) return `${String(hour).padStart(2, '0')}:00`;
  }

  if (medication && medication.times.length > 1) {
    if (/\bmorning|breakfast|am\b/i.test(text)) {
      return medication.times.slice().sort()[0];
    }
    if (/\bevening|night|dinner|pm\b/i.test(text)) {
      return medication.times.slice().sort().at(-1);
    }
  }
  return undefined;
}

function careReply(summary: {
  asOf: string;
  taken: number;
  skipped: number;
  missed: number;
  due: number;
  upcoming: number;
  slots: Array<{ petName: string; medicationName: string; strength?: string; status: string; scheduledFor: string }>;
}): string {
  const pending = summary.slots.filter((slot) => slot.status === 'due' || slot.status === 'missed');
  const upcoming = summary.slots.filter((slot) => slot.status === 'upcoming');
  const lines: string[] = [`It is ${formatTime(summary.asOf)}.`];

  if (summary.missed > 0) {
    const missed = summary.slots.filter((slot) => slot.status === 'missed');
    lines.push(`Missed: ${missed.map((slot) => `${slot.petName}’s ${slot.medicationName} at ${formatTime(slot.scheduledFor)}`).join('; ')}.`);
  }

  if (pending.length > 0) {
    lines.push(
      `Due now: ${pending
        .map((slot) => `${slot.petName} — ${slot.medicationName}${slot.strength ? ` ${slot.strength}` : ''} (${formatTime(slot.scheduledFor)})`)
        .join('; ')}.`,
    );
  } else if (upcoming.length > 0) {
    lines.push(
      `Next: ${upcoming
        .map((slot) => `${slot.petName} — ${slot.medicationName}${slot.strength ? ` ${slot.strength}` : ''} (${formatTime(slot.scheduledFor)})`)
        .join('; ')}.`,
    );
  } else {
    lines.push('Nothing else is scheduled tonight.');
  }

  lines.push(`${summary.taken} dose${summary.taken === 1 ? '' : 's'} logged as taken today${summary.skipped > 0 ? `, ${summary.skipped} skipped` : ''}.`);
  return lines.join(' ');
}

function exposureNextStep(assessment: AssessmentResult): string {
  const { emergency, primary, poisonControl } = assessment.contacts;
  if (assessment.verdict === 'emergency') {
    return emergency ? `Call ${emergency.name} at ${emergency.phone} now.` : 'Call your emergency veterinarian now.';
  }
  if (assessment.verdict === 'call_vet') {
    return primary
      ? `Call ${primary.name} at ${primary.phone}; if it is closed, call ${emergency?.name ?? 'your emergency clinic'}.`
      : 'Call your veterinarian now.';
  }
  if (assessment.verdict === 'unverified') {
    return `Call ${poisonControl.name} at ${poisonControl.phone} before you decide what to do.`;
  }
  return `If you see vomiting, tremors, wobbliness or anything that worries you, call ${primary?.name ?? 'your veterinarian'}.`;
}

function exposureReply(assessment: AssessmentResult): string {
  const source = assessment.findings.find((finding) => finding.evidence.publisher)?.evidence;
  const citation = source?.publisher
    ? ` Source: ${source.publisher}${source.url ? ` — ${source.url}` : ''}.`
    : '';
  const recorded = assessment.recorded ? ' This is on the household record.' : '';
  return `${assessment.headline} ${assessment.summary}${citation}${recorded}`.replace(/\s+/g, ' ').trim();
}

function verdictTone(verdict: Verdict): string {
  switch (verdict) {
    case 'emergency':
      return 'emergency';
    case 'call_vet':
      return 'call_vet';
    case 'monitor':
      return 'monitor';
    case 'no_known_toxicity':
      return 'no_known_toxicity';
    default:
      return 'unverified';
  }
}

export async function runScriptedAgent(options: {
  client: Client;
  message: string;
  context: ScriptedContext;
  state: ScriptedState;
}): Promise<AgentResult> {
  const { client, message, context, state } = options;
  const text = message.trim();
  const normalised = lower(text);
  const steps: AgentStep[] = [];

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await callTool(client, name, args);
    steps.push({
      tool: name,
      args,
      ok: result.ok,
      text: result.text,
      ...(result.structured !== undefined ? { structured: result.structured } : {}),
    });
    return result;
  };

  /** Phone numbers come from the household record, never from a constant here. */
  const contacts = async (): Promise<{ emergency?: { name: string; phone: string } }> => {
    const household = await call('get_household', {});
    const clinics =
      (household.structured as { clinics?: Array<{ name: string; phone: string; kind: string }> } | undefined)?.clinics ?? [];
    return { emergency: clinics.find((clinic) => clinic.kind === 'emergency') };
  };

  /* ---------------------------------------------------------------- *
   * 1. Confirmation of a pending record change.
   * ---------------------------------------------------------------- */
  if (state.pendingToken && YES.test(normalised)) {
    const token = state.pendingToken;
    const result = await call('apply_record_change', { token });
    state.pendingToken = undefined;
    state.pendingSummary = undefined;
    if (!result.ok) return { reply: result.text, steps, provider: 'scripted' };
    const applied = result.structured as { summary?: string } | undefined;
    return {
      reply: `Done — ${applied?.summary ?? 'the record is updated.'} The change is on the household record.`,
      steps,
      provider: 'scripted',
    };
  }

  if (state.pendingToken && NO.test(normalised)) {
    state.pendingToken = undefined;
    state.pendingSummary = undefined;
    return { reply: 'Okay — I did not change anything.', steps, provider: 'scripted' };
  }

  /* ---------------------------------------------------------------- *
   * 2. Exposure / "is this safe?" — the safety engine decides.
   * ---------------------------------------------------------------- */
  const toxin = toxinFrom(normalised);
  const exposureSignal = EXPOSURE_VERB.test(normalised) || (toxin && (CONSIDERING.test(normalised) || HELP_WORDS.test(normalised)));

  /* ---------------------------------------------------------------- *
   * 2a. Exposure history — "what did Mochi eat today?". Only the log
   *     is read; a new exposure still goes to the safety engine.
   * ---------------------------------------------------------------- */
  if (
    EXPOSURE_HISTORY_SUBJECT.test(normalised) &&
    EXPOSURE_HISTORY_ACTIVITY.test(normalised) &&
    EXPOSURE_HISTORY_TIME.test(normalised) &&
    !(toxin && EXPOSURE_VERB.test(normalised))
  ) {
    const pet = petFrom(context, normalised);
    const args: Record<string, unknown> = {};
    if (pet) args.pet = pet.name;
    if (/\btoday\b/i.test(normalised)) {
      args.day = todayKey();
    } else if (/\byesterday\b/i.test(normalised)) {
      args.day = todayKey(new Date(now().getTime() - 86_400_000));
    }

    const result = await call('list_exposures', args);
    if (!result.ok) return { reply: result.text, steps, provider: 'scripted' };

    const history = result.structured as {
      pet: string;
      day?: string;
      count: number;
      exposures: Array<{ toxinName: string; verdict: string; observedAt: string }>;
    };
    const where = history.day ? ` on ${history.day}` : '';
    if (history.count === 0) {
      return {
        reply: `No exposures are recorded for ${pet?.name ?? 'this household'}${where}. Nothing logged is not the same as nothing eaten.`,
        steps,
        provider: 'scripted',
      };
    }
    return {
      reply: `${history.pet} — ${history.count} recorded exposure${history.count === 1 ? '' : 's'}${where}: ${history.exposures
        .map((entry) => `${formatTime(entry.observedAt)} ${entry.toxinName} (${entry.verdict})`)
        .join('; ')}.`,
      steps,
      provider: 'scripted',
    };
  }

  if (toxin && exposureSignal) {
    const pet = petFrom(context, normalised) ?? (context.pets.length === 1 ? context.pets[0] : undefined);
    const intent: 'ingested' | 'considering' = /can (he|she|they|i)|should (he|she|i)|is it (ok|okay|safe)|would it be|okay to|safe to/i.test(normalised)
      ? 'considering'
      : 'ingested';

    if (!pet) {
      return {
        reply: `Which pet got into the ${toxin.name.toLowerCase()}? I have ${context.pets.map((entry) => entry.name).join(' and ')} on this household.`,
        steps,
        provider: 'scripted',
      };
    }

    const amount = adjustForChocolate(toxin.id, amountFrom(text));
    const product = productFrom(toxin.id, normalised);
    const symptoms = symptomsFrom(normalised);

    const args: Record<string, unknown> = { pet: pet.name, substance: toxin.alias, intent };
    if (amount) {
      args.amountValue = amount.value;
      args.amountUnit = amount.unit;
    }
    if (product) args.product = product;
    if (symptoms.length > 0) args.symptoms = symptoms;

    const result = await call('assess_toxin_exposure', args);
    if (!result.ok) return { reply: result.text, steps, provider: 'scripted' };

    const assessment = result.structured as AssessmentResult;
    state.lastToxin = toxin.id;
    state.lastPet = pet.name;
    state.lastExposure = {
      pet: pet.name,
      substance: toxin.alias,
      intent,
      ...(amount ? { amountValue: amount.value, amountUnit: amount.unit } : {}),
      ...(product ? { product } : {}),
      symptoms,
    };

    // A single sentence may both report an exposure and ask to tell someone.
    // Queue the alert only after the assessment exists, so the message carries
    // the verdict and the phone number rather than a guess.
    if (ALERT_VERB.test(normalised)) {
      const person = personFrom(context, normalised);
      if (person) {
        const body = trim(
          `${pet.name}: ${assessment.headline} ${exposureNextStep(assessment)} — Vetwise verdict: ${verdictTone(assessment.verdict)}.`,
          400,
        );
        await call('alert_caregiver', { to: person.split(/\s+/)[0], channel: 'sms', body });
      }
    }

    const reply = exposureReply(assessment);
    state.lastReply = reply;
    return { reply, steps, provider: 'scripted' };
  }

  /* ---------------------------------------------------------------- *
   * 2b. A symptom follow-up ("now she's drooling and shaky") re-runs the
   *     same exposure with the new signs. Symptoms can only raise a verdict.
   * ---------------------------------------------------------------- */
  const followUpSymptoms = symptomsFrom(normalised);
  if (!toxin && state.lastExposure && followUpSymptoms.length > 0) {
    const merged = Array.from(new Set([...state.lastExposure.symptoms, ...followUpSymptoms]));
    const result = await call('assess_toxin_exposure', { ...state.lastExposure, symptoms: merged });
    if (!result.ok) return { reply: result.text, steps, provider: 'scripted' };
    const assessment = result.structured as AssessmentResult;
    state.lastExposure = { ...state.lastExposure, symptoms: merged };
    const reply = exposureReply(assessment);
    state.lastReply = reply;
    return { reply, steps, provider: 'scripted' };
  }

  /* ---------------------------------------------------------------- *
   * 2c. Something was eaten, but it is not in the catalogue. Ask the
   *     engine anyway: it must answer `unverified`, never reassurance.
   * ---------------------------------------------------------------- */
  const ingested = /\b(ate|eaten|munched|snacked|chowed|gulped|scarfed|devoured|snaffled|swallowed|ingested|consumed|licked|drank|chewed|got into|got in|got a ?hold of|stole|grabbed|nibbled|tasted)\b/i.exec(
    normalised,
  );
  if (ingested && !toxin) {
    const pet = petFrom(context, normalised);
    if (pet) {
      const substance = substanceFrom(text, ingested);
      if (substance) {
        const result = await call('assess_toxin_exposure', {
          pet: pet.name,
          substance,
          intent: 'ingested',
          symptoms: symptomsFrom(normalised),
        });
        if (result.ok) {
          const assessment = result.structured as AssessmentResult;
          state.lastPet = pet.name;
          state.lastReply = exposureReply(assessment);
          return { reply: state.lastReply, steps, provider: 'scripted' };
        }
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * 2d. A symptom with no exposure attached is still a care event:
   *     put it on the record and name who to call.
   * ---------------------------------------------------------------- */
  const standaloneSymptoms = symptomsFrom(normalised);
  if (standaloneSymptoms.length > 0) {
    const pet = petFrom(context, normalised) ?? (context.pets.length === 1 ? context.pets[0] : undefined);
    if (pet) {
      const severity = standaloneSymptoms.some((entry) => ['seizure', 'collapse', 'difficulty_breathing'].includes(entry))
        ? 'severe'
        : 'moderate';
      const logged = await call('log_care_event', {
        pet: pet.name,
        kind: 'symptom',
        symptom: standaloneSymptoms[0],
        severity,
      });
      if (logged.ok) {
        const { emergency } = await contacts();
        const urgent = severity === 'severe';
        return {
          reply: urgent
            ? `I logged ${standaloneSymptoms.join(' and ')} for ${pet.name} as a severe sign. ${emergency ? `Call ${emergency.name} at ${emergency.phone}` : 'Call your veterinarian'} now — do not wait to see if it passes.`
            : `I logged ${standaloneSymptoms.join(' and ')} for ${pet.name}. ${emergency ? `If it continues, gets worse, or comes with tremors, collapse or trouble breathing, call ${emergency.name} at ${emergency.phone}` : 'If it continues or gets worse, call your veterinarian'}.`,
          steps,
          provider: 'scripted',
        };
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * 3. Logging a medication.
   * ---------------------------------------------------------------- */
  const medication = medicationFrom(context, normalised);
  const logVerb = MED_LOG_VERB.test(normalised);
  const looksLikeExposureLog = /\b(gave|give|administered|dosed)\b/i.test(normalised) && toxin !== undefined;

  if (medication && logVerb && !looksLikeExposureLog) {
    const pet = petFrom(context, normalised) ?? context.pets.find((entry) => entry.name === medication.petName);
    if (!pet) {
      return { reply: `Which pet is ${medication.name} for?`, steps, provider: 'scripted' };
    }
    const skipped = /\b(skipped|missed|refused|didn'?t give|did not give)\b/i.test(normalised);
    const scheduledTime = timeFrom(text, medication);

    const args: Record<string, unknown> = {
      pet: pet.name,
      kind: 'medication',
      medication: medication.name,
      status: skipped ? 'skipped' : 'taken',
    };
    if (scheduledTime) args.scheduledTime = scheduledTime;

    const result = await call('log_care_event', args);
    if (!result.ok) return { reply: result.text, steps, provider: 'scripted' };
    const logged = result.structured as { message?: string } | undefined;
    return {
      reply: `${logged?.message ?? `Logged ${medication.name} for ${pet.name}.`} Anything else?`,
      steps,
      provider: 'scripted',
    };
  }

  /* ---------------------------------------------------------------- *
   * 4. Care summary / greeting.
   * ---------------------------------------------------------------- */
  const asksCare =
    GREETING.test(normalised) ||
    /\b(taken|took|due|overdue|missed|schedule|next dose|what.*give|did .* get|has .* had)\b/i.test(normalised);

  if (asksCare && !STOP_WORDS.test(normalised)) {
    const pet = petFrom(context, normalised);
    const args: Record<string, unknown> = pet ? { pet: pet.name } : {};
    const result = await call('get_care_summary', args);
    if (!result.ok) return { reply: result.text, steps, provider: 'scripted' };
    return { reply: careReply(result.structured as Parameters<typeof careReply>[0]), steps, provider: 'scripted' };
  }

  /* ---------------------------------------------------------------- *
   * 5. Record changes: stop / pause / resume, or a new weight.
   * ---------------------------------------------------------------- */
  if (WEIGHT_WORDS.test(normalised)) {
    const pet = petFrom(context, normalised) ?? (context.pets.length === 1 ? context.pets[0] : undefined);
    const pounds = /\b(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds?)\b/i.exec(text);
    const kilos = /\b(\d+(?:\.\d+)?)\s*(?:kg|kilograms?)\b/i.exec(text);
    const value = kilos ? Number(kilos[1]) : pounds ? Number(pounds[1]) * 0.45359237 : undefined;
    const rounded = value !== undefined ? Math.round(value * 10) / 10 : undefined;

    if (!pet) return { reply: 'Which pet is that weight for?', steps, provider: 'scripted' };
    if (rounded === undefined) {
      return { reply: `Tell me ${pet.name}’s new weight in kilograms, for example 13.6 kg.`, steps, provider: 'scripted' };
    }

    const result = await call('propose_record_change', { action: 'pet.weight', pet: pet.name, weightKg: rounded });
    if (!result.ok) return { reply: result.text, steps, provider: 'scripted' };
    const proposal = result.structured as { token: string; summary: string };
    state.pendingToken = proposal.token;
    state.pendingSummary = proposal.summary;
    return {
      reply: `${proposal.summary} I have not changed anything yet — say yes and I will apply it.`,
      steps,
      provider: 'scripted',
      pendingConfirmation: { token: proposal.token, summary: proposal.summary },
    };
  }

  if (STOP_WORDS.test(normalised) && medication) {
    const pet = petFrom(context, normalised) ?? context.pets.find((entry) => entry.name === medication.petName);
    if (!pet) return { reply: `Which pet is ${medication.name} for?`, steps, provider: 'scripted' };

    const action = /\b(resume|restart|start again|put .* back on)\b/i.test(normalised)
      ? 'medication.resume'
      : /\b(pause|hold)\b/i.test(normalised)
        ? 'medication.pause'
        : 'medication.stop';

    const reason = reasonFrom(text);
    const result = await call('propose_record_change', {
      action,
      pet: pet.name,
      medication: medication.name,
      ...(reason ? { reason } : {}),
    });
    if (!result.ok) return { reply: result.text, steps, provider: 'scripted' };
    const proposal = result.structured as { token: string; summary: string };
    state.pendingToken = proposal.token;
    state.pendingSummary = proposal.summary;
    return {
      reply: `${proposal.summary} I have not changed anything yet — say yes and I will apply it. Never stop a prescribed medicine without your veterinarian’s agreement.`,
      steps,
      provider: 'scripted',
      pendingConfirmation: { token: proposal.token, summary: proposal.summary },
    };
  }

  /* ---------------------------------------------------------------- *
   * 6. Alert a household member.
   * ---------------------------------------------------------------- */
  if (ALERT_VERB.test(normalised)) {
    const person = personFrom(context, normalised);
    if (!person) {
      return {
        reply: `I can text ${context.people.join(' or ')} — alerts only go to people on this household record.`,
        steps,
        provider: 'scripted',
      };
    }
    const shortRequest = normalised.split(/\s+/).filter(Boolean).length <= 8;
    const body = trim(shortRequest && state.lastReply ? `Vetwise update — ${state.lastReply}` : text, 400);
    const result = await call('alert_caregiver', { to: person.split(/\s+/)[0], channel: 'sms', body });
    if (!result.ok) return { reply: result.text, steps, provider: 'scripted' };
    return { reply: `Queued a text to ${person}. It is in the outbox and will be delivered to the number on file.`, steps, provider: 'scripted' };
  }

  /* ---------------------------------------------------------------- *
   * 7. Profile / allergies / conditions.
   * ---------------------------------------------------------------- */
  if (/\b(allerg|condition|diagnos|microchip|breed|how old|weight|weigh)\b/i.test(normalised)) {
    const pet = petFrom(context, normalised);
    if (pet) {
      const result = await call('get_pet', { pet: pet.name });
      if (result.ok) {
        const data = result.structured as {
          pet: { name: string; breed: string; ageYears: number; weightKg: number; conditions: string[]; allergies: Array<{ substance: string; reaction: string; severity: string }> };
        };
        const record = data.pet;
        const allergyLine =
          record.allergies.length > 0
            ? `Allergies: ${record.allergies.map((allergy) => `${allergy.substance} (${allergy.reaction.toLowerCase()}, ${allergy.severity})`).join('; ')}.`
            : 'No allergies are recorded.';
        return {
          reply: `${record.name} is a ${record.ageYears}-year-old ${record.breed}, ${record.weightKg} kg. Conditions: ${record.conditions.join(', ') || 'none recorded'}. ${allergyLine}`,
          steps,
          provider: 'scripted',
        };
      }
      return { reply: result.text, steps, provider: 'scripted' };
    }
  }

  /* ---------------------------------------------------------------- *
   * 8. Medication list.
   * ---------------------------------------------------------------- */
  if (/\b(medications?|medicines?|prescriptions?|what.*(take|taking)|list)\b/i.test(normalised)) {
    const pet = petFrom(context, normalised);
    const status = /\b(all|stopped|inactive|every)\b/i.test(normalised) ? 'all' : 'active';
    const result = await call('list_medications', { ...(pet ? { pet: pet.name } : {}), status });
    if (!result.ok) return { reply: result.text, steps, provider: 'scripted' };
    const data = result.structured as {
      pet: string;
      medications: Array<{ name: string; strength?: string; doseLabel: string; scheduleLabel: string; status: string }>;
    };
    if (data.medications.length === 0) {
      return { reply: `No ${status === 'all' ? '' : `${status} `}medications are on file for ${data.pet}.`, steps, provider: 'scripted' };
    }
    return {
      reply: `${data.pet}: ${data.medications
        .map((entry) => `${entry.name}${entry.strength ? ` ${entry.strength}` : ''} — ${entry.doseLabel} at ${entry.scheduleLabel} (${entry.status})`)
        .join('; ')}.`,
      steps,
      provider: 'scripted',
    };
  }

  /* ---------------------------------------------------------------- *
   * 9. No delete tool exists. Say so instead of offering a menu.
   * ---------------------------------------------------------------- */
  if (/\b(delete|remove|erase|purge|wipe|drop)\b/i.test(normalised)) {
    return {
      reply:
        'Vetwise has no delete tool: the server can add to the record but never remove from it. Ask Maya, the account owner, if a record needs correcting.',
      steps,
      provider: 'scripted',
    };
  }

  /* ---------------------------------------------------------------- *
   * 10. Fallback — name what the server can do, and the poison number.
   * ---------------------------------------------------------------- */
  return {
    reply:
      'I can check tonight’s doses, work out whether something a pet ate is dangerous, log a medication, text Maya, or prepare a record change. ' +
      'If an exposure is happening right now, call ASPCA Animal Poison Control at (888) 426-4435.',
    steps,
    provider: 'scripted',
  };
}
