import { now } from '../clock.js';
import type {
  AmountUnit,
  Clinic,
  ExposureAssessment,
  ExposureFinding,
  Pet,
  Species,
  Symptom,
  ToxinCategory,
  Verdict,
} from './types.js';
import { bandsFor, findProduct, type DoseBand, type Toxin, type ToxinProduct } from './toxins.js';

export const VERDICT_RANK: Record<Verdict, number> = {
  no_known_toxicity: 1,
  monitor: 2,
  unverified: 3,
  call_vet: 4,
  emergency: 5,
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  emergency: 'Emergency',
  call_vet: 'Call your vet',
  monitor: 'Monitor',
  no_known_toxicity: 'Below toxic threshold',
  unverified: 'Unverified',
};

const SEVERE_SYMPTOMS = new Set<Symptom>(['seizure', 'collapse', 'difficulty_breathing', 'tremors']);
const MODERATE_SYMPTOMS = new Set<Symptom>(['vomiting', 'diarrhea', 'lethargy', 'drooling', 'abdominal_pain']);

const SYMPTOM_LABEL: Record<Symptom, string> = {
  vomiting: 'vomiting',
  diarrhea: 'diarrhea',
  lethargy: 'lethargy',
  tremors: 'tremors',
  seizure: 'a seizure',
  collapse: 'collapse',
  difficulty_breathing: 'difficulty breathing',
  drooling: 'drooling',
  abdominal_pain: 'abdominal pain',
};

export interface ExposureContacts {
  primary?: Clinic;
  emergency?: Clinic;
  poisonControl: Clinic;
}

export interface ExposureInput {
  pet: Pick<Pet, 'id' | 'name' | 'species' | 'weightKg'> & { weightUpdatedAt?: string };
  toxin: Toxin;
  product?: ToxinProduct;
  productText?: string;
  amount?: { value: number; unit: AmountUnit };
  intent: 'ingested' | 'considering';
  symptoms: Symptom[];
  contacts: ExposureContacts;
}

interface BaseAmount {
  value: number;
  unit: 'mg' | 'g' | 'ml' | 'piece';
}

type AmountResult = { ok: true; amount: BaseAmount; normalised: string } | { ok: false; reason: string };

function fail(reason: string): AmountResult {
  return { ok: false, reason };
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function normaliseLabel(value: number, unit: BaseAmount['unit']): string {
  if (unit === 'mg') return `${round(value, value < 10 ? 2 : 0)} mg`;
  if (unit === 'g') return `${round(value, 2)} g`;
  if (unit === 'ml') return `${round(value, 2)} ml`;
  return `${round(value, 2)} ${value === 1 ? 'piece' : 'pieces'}`;
}

/** Convert whatever the caregiver said into the toxin's dose basis. */
export function toBaseAmount(
  toxin: Toxin,
  product: ToxinProduct | undefined,
  amount: { value: number; unit: AmountUnit },
): AmountResult {
  const value = amount.value;
  if (!Number.isFinite(value) || value <= 0) return fail('The amount needs to be a positive number.');

  const { unit, basis } = { unit: amount.unit, basis: toxin.basis };

  if (unit === 'mg') {
    if (basis === 'mg_per_kg') return { ok: true, amount: { value, unit: 'mg' }, normalised: normaliseLabel(value, 'mg') };
    if (basis === 'g_per_kg') return { ok: true, amount: { value: value / 1000, unit: 'g' }, normalised: normaliseLabel(value / 1000, 'g') };
    if (basis === 'ml_per_kg') return { ok: true, amount: { value: value / 1000, unit: 'ml' }, normalised: normaliseLabel(value / 1000, 'ml') };
    return fail('Milligrams cannot be converted into pieces without a product.');
  }

  if (unit === 'g' || unit === 'kg' || unit === 'oz') {
    const grams = unit === 'g' ? value : unit === 'kg' ? value * 1000 : value * 28.3495;
    if (basis === 'mg_per_kg') {
      if (product?.mgPerGram) return { ok: true, amount: { value: grams * product.mgPerGram, unit: 'mg' }, normalised: normaliseLabel(grams * product.mgPerGram, 'mg') };
      if (product?.mgPerMl) return { ok: true, amount: { value: grams * product.mgPerMl, unit: 'mg' }, normalised: normaliseLabel(grams * product.mgPerMl, 'mg') };
      return fail('I need the product type to know how much of the toxic principle is in that weight.');
    }
    if (basis === 'g_per_kg') {
      if (product?.gramsPerMl) {
        const gramsOfActive = grams * product.gramsPerMl;
        return { ok: true, amount: { value: gramsOfActive, unit: 'g' }, normalised: normaliseLabel(gramsOfActive, 'g') };
      }
      return { ok: true, amount: { value: grams, unit: 'g' }, normalised: normaliseLabel(grams, 'g') };
    }
    if (basis === 'ml_per_kg') {
      return { ok: true, amount: { value: grams, unit: 'ml' }, normalised: normaliseLabel(grams, 'ml') };
    }
    if (basis === 'pieces_per_kg') {
      if (!product?.gramsPerPiece) return fail('I need to know the weight of one piece to convert that amount.');
      return {
        ok: true,
        amount: { value: grams / product.gramsPerPiece, unit: 'piece' },
        normalised: `${round(grams / product.gramsPerPiece, 2)} ${round(grams / product.gramsPerPiece, 2) === 1 ? 'piece' : 'pieces'}`,
      };
    }
  }

  if (unit === 'ml' || unit === 'tsp' || unit === 'tbsp') {
    const millilitres = unit === 'ml' ? value : unit === 'tsp' ? value * 5 : value * 15;
    if (basis === 'mg_per_kg') {
      if (product?.mgPerMl) return { ok: true, amount: { value: millilitres * product.mgPerMl, unit: 'mg' }, normalised: normaliseLabel(millilitres * product.mgPerMl, 'mg') };
      if (product?.mgPerGram) return { ok: true, amount: { value: millilitres * product.mgPerGram, unit: 'mg' }, normalised: normaliseLabel(millilitres * product.mgPerGram, 'mg') };
      return fail('I need the product strength to convert millilitres into milligrams.');
    }
    if (basis === 'g_per_kg') {
      if (product?.gramsPerMl) return { ok: true, amount: { value: millilitres * product.gramsPerMl, unit: 'g' }, normalised: normaliseLabel(millilitres * product.gramsPerMl, 'g') };
      return { ok: true, amount: { value: millilitres, unit: 'g' }, normalised: normaliseLabel(millilitres, 'g') };
    }
    if (basis === 'ml_per_kg') {
      return { ok: true, amount: { value: millilitres, unit: 'ml' }, normalised: normaliseLabel(millilitres, 'ml') };
    }
    return fail('Millilitres cannot be converted into pieces without more information.');
  }

  // pieces, bars, squares, tablets
  if (basis === 'pieces_per_kg') {
    return { ok: true, amount: { value, unit: 'piece' }, normalised: normaliseLabel(value, 'piece') };
  }
  if (!product) return fail('I need the product type to know how much is in one piece.');

  if (basis === 'mg_per_kg') {
    if (product.mgPerPiece) {
      const mg = value * product.mgPerPiece;
      return { ok: true, amount: { value: mg, unit: 'mg' }, normalised: normaliseLabel(mg, 'mg') };
    }
    if (product.mgPerGram && product.gramsPerPiece) {
      const mg = value * product.mgPerGram * product.gramsPerPiece;
      return { ok: true, amount: { value: mg, unit: 'mg' }, normalised: normaliseLabel(mg, 'mg') };
    }
    if (product.mgPerMl && product.gramsPerPiece) {
      const mg = value * product.mgPerMl * product.gramsPerPiece;
      return { ok: true, amount: { value: mg, unit: 'mg' }, normalised: normaliseLabel(mg, 'mg') };
    }
    return fail('I need the strength of one piece to make that calculation.');
  }

  if (basis === 'g_per_kg') {
    if (product.gramsPerPiece) {
      const grams = value * product.gramsPerPiece;
      return { ok: true, amount: { value: grams, unit: 'g' }, normalised: normaliseLabel(grams, 'g') };
    }
    return fail('I need the weight of one piece to make that calculation.');
  }

  if (basis === 'ml_per_kg') {
    if (product.gramsPerPiece) {
      const ml = value * product.gramsPerPiece;
      return { ok: true, amount: { value: ml, unit: 'ml' }, normalised: normaliseLabel(ml, 'ml') };
    }
    return fail('I need the volume of one piece to make that calculation.');
  }

  return fail('That amount could not be converted.');
}

function contactLine(label: string, clinic: Clinic | undefined): string | undefined {
  if (!clinic) return undefined;
  return `${label}: ${clinic.name} — ${clinic.phone}`;
}

function nextStep(input: ExposureInput, verdict: Verdict): string {
  const { emergency, primary, poisonControl } = input.contacts;
  if (verdict === 'emergency') {
    return emergency ? `Call ${emergency.name} at ${emergency.phone} now.` : `Call your emergency veterinarian now.`;
  }
  if (verdict === 'call_vet') {
    return primary ? `Call ${primary.name} at ${primary.phone}; if it is closed, call ${emergency?.name ?? 'your emergency clinic'}.` : `Call your veterinarian now.`;
  }
  if (verdict === 'unverified') {
    return `Call ${poisonControl.name} at ${poisonControl.phone} before you decide what to do.`;
  }
  return `Call ${primary?.name ?? 'your veterinarian'} if you see vomiting, tremors, wobbliness, or anything that worries you.`;
}

function symptomFinding(symptom: Symptom): ExposureFinding {
  const severe = SEVERE_SYMPTOMS.has(symptom);
  return {
    severity: severe ? 'critical' : 'urgent',
    title: severe ? `Reported ${SYMPTOM_LABEL[symptom]}` : `Reported ${SYMPTOM_LABEL[symptom]}`,
    detail: severe
      ? 'This sign can indicate a life-threatening exposure and raises the response to an emergency.'
      : 'This sign is concerning and raises the response to at least a call to your veterinarian.',
    evidence: {
      source: 'symptom',
      quote: `Caregiver reported: ${SYMPTOM_LABEL[symptom]}.`,
    },
  };
}

export function assessExposure(input: ExposureInput): ExposureAssessment {
  const started = performance.now();
  const { pet, toxin, product, amount, intent, symptoms } = input;
  // A pet record always has a species today, but the engine keeps an explicit
  // unknown path so a partial import can never be treated as reassurance.
  const species = pet.species as Species | 'unknown';
  const findings: ExposureFinding[] = [];
  const assumptions: string[] = [];
  const limitations = [...(toxin.limitations ?? [])];
  const resolvedProduct = product ?? (input.productText ? findProduct(toxin, input.productText) : undefined);

  let verdict: Verdict = 'unverified';
  // A gate (species, intent, missing fact) may already have decided the floor.
  // The dose bands may raise that verdict, but they must never lower it.
  let decided = false;
  let headline = `I can’t verify this exposure for ${pet.name} yet.`;
  let summary = '';
  let dosePerKg: number | undefined;
  let threshold: ExposureAssessment['threshold'];
  let nextThreshold: ExposureAssessment['nextThreshold'];
  let escalation: ExposureAssessment['escalation'];
  let anyAmountRule = false;

  const speciesKnown = (species as string) !== 'unknown';
  const speciesCovered = speciesKnown && toxin.species.includes(species as Species);
  const bands = speciesKnown ? bandsFor(toxin, species) : toxin.bands;
  const scale = bands.map((band) => ({ at: band.at, label: band.label, verdict: band.verdict }));

  const setVerdict = (next: Verdict, reason: string) => {
    if (VERDICT_RANK[next] <= VERDICT_RANK[verdict]) return;
    escalation = { reason, from: verdict, to: next };
    verdict = next;
  };

  // 1. Species is the first gate. A missing or mismatched species never becomes
  //    reassurance; it becomes `unverified` with a concrete next step.
  if (!speciesKnown) {
    verdict = 'unverified';
    decided = true;
    headline = `I need to know whether ${pet.name} is a dog or a cat.`;
    summary = 'The toxic dose and the risk are different for dogs and cats, so Vetwise will not estimate this one.';
    findings.push({
      severity: 'urgent',
      title: 'Species is not recorded',
      detail: 'Add the species to the pet record, or tell the poison-control clinician whether this is a dog or a cat.',
      evidence: { source: 'record', quote: `Pet record for ${pet.name} has no species.` },
    });
  } else if (!speciesCovered) {
    verdict = 'unverified';
    decided = true;
    headline = `There is no established ${toxin.name} toxicosis record for ${species === 'cat' ? 'cats' : 'dogs'}.`;
    summary = 'Absence of data is not the same as safety. Vetwise will not clear this exposure for a species that is not in the source material.';
    findings.push({
      severity: 'urgent',
      title: `Not a documented ${species} toxicosis`,
      detail: `The curated sources document this toxin in ${toxin.species.join(' and ')}. They do not establish a safe dose for a ${species}.`,
      evidence: {
        source: 'curated',
        publisher: toxin.sources[0]?.publisher,
        title: toxin.sources[0]?.title,
        ...(toxin.sources[0]?.url ? { url: toxin.sources[0].url } : {}),
        quote: toxin.sources[0]?.quote,
      },
    });
  }

  // 2. Intent. A "can I give this?" question about a human medicine or a
  //    household product is never answered with a dose; it is a call-vet answer.
  if (speciesKnown && speciesCovered && intent === 'considering' && toxin.category !== 'food') {
    verdict = 'call_vet';
    decided = true;
    headline = `Do not give ${toxin.name} to ${pet.name}.`;
    summary = `Vetwise does not clear human medications, plants, pesticides, or household products for pets. Call your veterinarian before giving anything.`;
    findings.push({
      severity: 'urgent',
      title: 'This is a “should I give it?” question, not a reported exposure',
      detail: 'The safe answer is to keep it away and ask your veterinarian. There is no home dose in this catalogue.',
      evidence: { source: 'curated', publisher: toxin.sources[0]?.publisher, title: toxin.sources[0]?.title, ...(toxin.sources[0]?.url ? { url: toxin.sources[0].url } : {}), quote: toxin.sources[0]?.quote },
    });
  }

  // 3. Amount and dose math. Unknown product, amount, or weight stays
  //    `unverified` unless the toxin has an any-exposure rule.
  let normalised: string | undefined;
  if (speciesKnown && speciesCovered) {
    if (!amount) {
      if (toxin.amountOptional && toxin.anyAmountVerdict) {
        if (decided) setVerdict(toxin.anyAmountVerdict, toxin.anyAmountNote ?? 'This toxin has an any-exposure rule.');
        else {
          verdict = toxin.anyAmountVerdict;
          decided = true;
        }
        anyAmountRule = true;
        assumptions.push('The amount is not needed for this toxin because any exposure warrants action.');
      } else if (!decided) {
        verdict = 'unverified';
        decided = true;
        headline = `How much ${toxin.name} did ${pet.name} get?`;
        summary = 'Vetwise will not guess at a dose. Tell me the amount and the product, or call poison control now.';
        findings.push({
          severity: 'urgent',
          title: 'Amount is missing',
          detail: 'Without an amount, a dose per kilogram cannot be calculated. That is an unverified answer, not a safe one.',
          evidence: { source: 'record', quote: 'No amount was supplied with the exposure.' },
        });
      } else {
        // A "do not give this" answer stays a call-vet answer even without an
        // amount; the missing amount is a note, not a downgrade.
        findings.push({
          severity: 'info',
          title: 'Amount is missing',
          detail: 'No amount was supplied, so no dose per kilogram was calculated. The verdict does not depend on it.',
          evidence: { source: 'record', quote: 'No amount was supplied with the exposure.' },
        });
      }
    } else {
      const converted = toBaseAmount(toxin, resolvedProduct, amount);
      if (!converted.ok) {
        if (!decided) {
          verdict = 'unverified';
          decided = true;
          headline = `I need one more detail about the ${toxin.name} product.`;
          summary = `${converted.reason} That is an unverified answer, not a safe one.`;
        }
        findings.push({
          severity: 'urgent',
          title: 'The amount could not be converted safely',
          detail: converted.reason,
          evidence: { source: 'curated', publisher: toxin.sources[0]?.publisher, title: toxin.sources[0]?.title, ...(toxin.sources[0]?.url ? { url: toxin.sources[0].url } : {}), quote: toxin.sources[0]?.quote },
        });
      } else {
        normalised = converted.normalised;
        if (pet.weightKg && pet.weightKg > 0) {
          dosePerKg = converted.amount.value / pet.weightKg;
          const applicable = [...bands].sort((a, b) => b.at - a.at).find((band) => dosePerKg! >= band.at);
          const upcoming = [...bands].sort((a, b) => a.at - b.at).find((band) => band.at > dosePerKg!);
          threshold = applicable
            ? {
                at: applicable.at,
                label: applicable.label,
                verdict: applicable.verdict,
                ...(applicable.detail ? { detail: applicable.detail } : {}),
              }
            : undefined;
          nextThreshold = upcoming ? { at: upcoming.at, label: upcoming.label, verdict: upcoming.verdict } : undefined;
          const bandVerdict = applicable?.verdict ?? toxin.anyAmountVerdict ?? 'no_known_toxicity';
          if (decided) {
            setVerdict(bandVerdict, applicable ? `The calculated dose falls in the “${applicable.label}” band.` : 'This toxin has an any-exposure rule.');
          } else {
            verdict = bandVerdict;
            decided = true;
          }
          if (!applicable && toxin.anyAmountVerdict) anyAmountRule = true;
          findings.push({
            severity: 'info',
            title: 'Dose calculation',
            detail: `${normalised} for a ${round(pet.weightKg, 1)} kg ${species} is about ${round(dosePerKg, 2)} ${toxin.unitLabel}.`,
            evidence: {
              source: 'record',
              quote: `${pet.name} weighs ${round(pet.weightKg, 1)} kg${pet.weightUpdatedAt ? ` (weight recorded ${pet.weightUpdatedAt.slice(0, 10)})` : ''}.`,
            },
          });
          if (resolvedProduct) {
            const note = resolvedProduct.note?.replace(/\.$/, '');
            assumptions.push(`Product assumed: ${resolvedProduct.label}${note ? ` — ${note}` : ''}.`);
          }
        } else {
          if (toxin.amountOptional && toxin.anyAmountVerdict) {
            if (decided) setVerdict(toxin.anyAmountVerdict, toxin.anyAmountNote ?? 'This toxin has an any-exposure rule.');
            else {
              verdict = toxin.anyAmountVerdict;
              decided = true;
            }
            anyAmountRule = true;
          } else if (!decided) {
            verdict = 'unverified';
            decided = true;
            headline = `I need ${pet.name}’s current weight.`;
            summary = 'A dose per kilogram cannot be calculated without a weight. That is an unverified answer, not a safe one.';
            findings.push({
              severity: 'urgent',
              title: 'Weight is missing',
              detail: 'Add the pet’s weight to the record, or tell the poison-control clinician the weight.',
              evidence: { source: 'record', quote: `No usable weight on file for ${pet.name}.` },
            });
          }
        }
      }
    }
  }

  // 4. Product-specific override (tea tree oil, an avocado pit, etc.).
  if (resolvedProduct?.verdict) {
    setVerdict(resolvedProduct.verdict, resolvedProduct.note ?? `${resolvedProduct.label} carries a higher-risk verdict.`);
    if (resolvedProduct.verdict === 'emergency') {
      headline = `${resolvedProduct.label} is an emergency for ${pet.name}.`;
    }
  }

  // 5. Symptoms can only raise the verdict.
  for (const symptom of symptoms) {
    findings.push(symptomFinding(symptom));
    if (SEVERE_SYMPTOMS.has(symptom)) {
      setVerdict('emergency', `Reported ${SYMPTOM_LABEL[symptom]} — this is an emergency sign.`);
    } else if (MODERATE_SYMPTOMS.has(symptom)) {
      setVerdict('call_vet', `Reported ${SYMPTOM_LABEL[symptom]} — this warrants a vet call.`);
    }
  }

  // 6. A known high-risk class gets a floor even before the math lands.
  if (speciesKnown && speciesCovered && toxin.anyAmountVerdict && toxin.amountOptional) {
    anyAmountRule = true;
    if (VERDICT_RANK[toxin.anyAmountVerdict] > VERDICT_RANK[verdict]) verdict = toxin.anyAmountVerdict;
  }

  // 7. Headline and summary by verdict.
  if (verdict === 'emergency') {
    headline = symptoms.some((symptom) => SEVERE_SYMPTOMS.has(symptom))
      ? `${pet.name} is showing emergency signs. Go now.`
      : `This is an emergency for ${pet.name}.`;
  } else if (verdict === 'call_vet') {
    headline =
      intent === 'considering' && toxin.category !== 'food'
        ? `Do not give ${toxin.name} to ${pet.name}.`
        : `Call your veterinarian about ${pet.name} now.`;
  } else if (verdict === 'monitor') {
    headline = `Keep a close eye on ${pet.name}.`;
  } else if (verdict === 'no_known_toxicity') {
    headline = `This amount is below the reported toxic threshold for ${pet.name}.`;
  } else if (verdict === 'unverified') {
    headline = headline || `I can’t verify this exposure for ${pet.name} yet.`;
  }

  const doseSentence = dosePerKg !== undefined && normalised
    ? `${normalised} for a ${round(pet.weightKg ?? 0, 1)} kg ${species} is about ${round(dosePerKg, 2)} ${toxin.unitLabel}.`
    : '';
  const thresholdSentence = threshold && threshold.at > 0
    ? `${escalation ? 'The dose alone' : 'That'} falls in the "${threshold.label}" band, which starts at ${round(threshold.at, 2)} ${toxin.unitLabel}.`
    : nextThreshold
      ? `The next threshold is “${nextThreshold.label}” at ${round(nextThreshold.at, 2)} ${toxin.unitLabel}.`
      : '';
  const anyAmountSentence = anyAmountRule && toxin.anyAmountNote ? toxin.anyAmountNote : '';

  const rationale = summary;
  summary = [
    doseSentence,
    thresholdSentence,
    anyAmountSentence,
    rationale,
    verdict === 'unverified'
      ? rationale
        ? ''
        : 'Vetwise is not reassuring you here: it does not have enough verified information to rule this out.'
      : nextStep(input, verdict),
  ]
    .filter(Boolean)
    .join(' ');

  // 8. Evidence. The primary source is attached to the verdict; the rest are
  //    separate citations so the UI can show every reference.
  const primarySource = toxin.sources[0];
  const verdictSeverity: ExposureFinding['severity'] =
    verdict === 'emergency' ? 'critical' : verdict === 'call_vet' || verdict === 'unverified' ? 'urgent' : verdict === 'monitor' ? 'watch' : 'info';

  findings.unshift({
    severity: verdictSeverity,
    title: threshold?.label ?? (anyAmountRule ? `${toxin.name}: any exposure rule` : `${VERDICT_LABEL[verdict]} for ${toxin.name}`),
    detail:
      verdict === 'unverified'
        ? 'The available information is incomplete, so the answer is unverified rather than safe.'
        : `${VERDICT_LABEL[verdict]}. ${threshold?.detail ?? toxin.anyAmountNote ?? toxin.summary}`,
    evidence: {
      source: 'curated',
      ...(primarySource?.publisher ? { publisher: primarySource.publisher } : {}),
      ...(primarySource?.title ? { title: primarySource.title } : {}),
      ...(primarySource?.url ? { url: primarySource.url } : {}),
      ...(primarySource?.quote ? { quote: primarySource.quote } : {}),
      ...(primarySource?.accessed ? { accessed: primarySource.accessed } : {}),
    },
  });

  for (const source of toxin.sources.slice(1)) {
    findings.push({
      severity: 'info',
      title: source.title,
      detail: `Additional source used for this assessment: ${source.publisher}.`,
      evidence: {
        source: 'curated',
        publisher: source.publisher,
        title: source.title,
        ...(source.url ? { url: source.url } : {}),
        quote: source.quote,
        accessed: source.accessed,
      },
    });
  }

  // 9. Assumptions and limitations are part of the answer, not footnotes.
  if (pet.weightKg && pet.weightKg > 0) {
    assumptions.push(`Weight used: ${round(pet.weightKg, 1)} kg.`);
  }
  assumptions.push('Signs are caregiver-reported, not a veterinary examination.');
  if (toxin.amountOptional) {
    assumptions.push('This toxin has an any-exposure rule; the verdict does not depend on a threshold calculation.');
  }
  limitations.push('This is a triage aid, not a diagnosis. A veterinarian who examines the pet may reach a different conclusion.');
  limitations.push('Thresholds are population estimates; individual pets can react at lower doses.');
  limitations.push('Vetwise does not advise inducing vomiting or give any home treatment.');

  const contacts = {
    ...(input.contacts.primary ? { primary: { name: input.contacts.primary.name, phone: input.contacts.primary.phone, ...(input.contacts.primary.hours ? { hours: input.contacts.primary.hours } : {}) } } : {}),
    ...(input.contacts.emergency ? { emergency: { name: input.contacts.emergency.name, phone: input.contacts.emergency.phone, ...(input.contacts.emergency.address ? { address: input.contacts.emergency.address } : {}) } } : {}),
    poisonControl: {
      name: input.contacts.poisonControl.name,
      phone: input.contacts.poisonControl.phone,
      ...(input.contacts.poisonControl.notes ? { note: input.contacts.poisonControl.notes } : {}),
    },
  };

  return {
    pet: {
      ...(pet.id ? { id: pet.id } : {}),
      name: pet.name,
      species,
      ...(pet.weightKg && pet.weightKg > 0 ? { weightKg: pet.weightKg } : {}),
    },
    toxin: {
      id: toxin.id,
      name: toxin.name,
      category: toxin.category,
      ...(resolvedProduct ? { product: resolvedProduct.label } : input.productText ? { product: input.productText } : {}),
    },
    ...(amount ? { amount: { value: amount.value, unit: amount.unit, ...(normalised ? { normalised } : {}) } } : {}),
    intent,
    verdict,
    headline,
    summary,
    ...(dosePerKg !== undefined ? { dosePerKg, doseUnit: toxin.unitLabel } : {}),
    ...(threshold ? { threshold } : {}),
    ...(nextThreshold ? { nextThreshold } : {}),
    ...(scale.length > 0 ? { scale } : {}),
    ...(anyAmountRule ? { anyAmountRule: true } : {}),
    ...(escalation ? { escalation } : {}),
    findings,
    signs: toxin.signs,
    firstAid: toxin.firstAid,
    contacts,
    assumptions,
    limitations,
    checkedAt: now().toISOString(),
    latencyMs: Math.max(1, Math.round(performance.now() - started)),
  };
}

export function renderAssessment(assessment: ExposureAssessment): string {
  const lines: string[] = [`${VERDICT_LABEL[assessment.verdict].toUpperCase()} — ${assessment.headline}`, assessment.summary];

  if (assessment.dosePerKg !== undefined) {
    lines.push(`Dose: about ${round(assessment.dosePerKg, 2)} ${assessment.doseUnit ?? ''}.`);
  }
  if (assessment.threshold) {
    lines.push(`Band: ${assessment.threshold.label} (starts at ${round(assessment.threshold.at, 2)}).`);
  }
  if (assessment.nextThreshold) {
    lines.push(`Next band: ${assessment.nextThreshold.label} at ${round(assessment.nextThreshold.at, 2)}.`);
  }

  lines.push('', 'Do now:');
  for (const step of assessment.firstAid) lines.push(`- ${step}`);

  const primary = contactLine('Primary vet', assessment.contacts.primary ? { id: '', kind: 'primary', ...assessment.contacts.primary } : undefined);
  const emergency = contactLine('Emergency', assessment.contacts.emergency ? { id: '', kind: 'emergency', ...assessment.contacts.emergency } : undefined);
  const poison = `Poison control: ${assessment.contacts.poisonControl.name} — ${assessment.contacts.poisonControl.phone}`;
  for (const line of [primary, emergency, poison]) if (line) lines.push(`- ${line}`);

  const citations = assessment.findings.filter((finding) => finding.evidence.quote && finding.evidence.source === 'curated');
  if (citations.length > 0) {
    lines.push('', 'Evidence:');
    for (const finding of citations.slice(0, 3)) {
      const evidence = finding.evidence;
      lines.push(`- ${evidence.publisher ?? 'Curated source'}${evidence.title ? `, ${evidence.title}` : ''}: “${evidence.quote}”${evidence.url ? ` (${evidence.url})` : ''}`);
    }
  }

  return lines.join('\n');
}

export function isSymptom(value: string): value is Symptom {
  return value in SYMPTOM_LABEL;
}

export function categoryLabel(category: ToxinCategory): string {
  return {
    food: 'Food',
    plant: 'Plant',
    human_medication: 'Human medication',
    household: 'Household',
    pesticide: 'Pesticide',
    metal: 'Metal',
    recreational: 'Recreational',
    unknown: 'Unverified substance',
  }[category];
}

export type { DoseBand };
