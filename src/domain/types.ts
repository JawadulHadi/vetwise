export type Species = 'dog' | 'cat';

/**
 * The five verdicts Vetwise is allowed to return. `unverified` is a first-class
 * answer: missing weight, amount, species or product evidence never becomes
 * reassurance by default.
 */
export type Verdict = 'emergency' | 'call_vet' | 'monitor' | 'no_known_toxicity' | 'unverified';

export type ToxinCategory =
  | 'food'
  | 'plant'
  | 'human_medication'
  | 'household'
  | 'pesticide'
  | 'metal'
  | 'recreational'
  | 'unknown';

export type AmountUnit =
  | 'mg'
  | 'g'
  | 'kg'
  | 'ml'
  | 'oz'
  | 'piece'
  | 'pieces'
  | 'tablet'
  | 'tablets'
  | 'bar'
  | 'bars'
  | 'square'
  | 'squares'
  | 'tsp'
  | 'tbsp';

export type Symptom =
  | 'vomiting'
  | 'diarrhea'
  | 'lethargy'
  | 'tremors'
  | 'seizure'
  | 'collapse'
  | 'difficulty_breathing'
  | 'drooling'
  | 'abdominal_pain';

export interface Allergy {
  substance: string;
  reaction: string;
  severity: 'mild' | 'moderate' | 'severe';
}

export interface Person {
  id: string;
  name: string;
  role: 'owner' | 'sitter' | 'family';
  phone?: string;
  notes?: string;
}

export interface Pet {
  id: string;
  name: string;
  species: Species;
  breed: string;
  sex: 'female' | 'male';
  neutered: boolean;
  ageYears: number;
  weightKg: number;
  weightUpdatedAt: string;
  conditions: string[];
  allergies: Allergy[];
  microchip?: string;
  diet?: string;
  notes?: string;
}

export interface Clinic {
  id: string;
  name: string;
  kind: 'primary' | 'emergency' | 'poison_control';
  phone: string;
  address?: string;
  hours?: string;
  url?: string;
  notes?: string;
}

export interface ScheduleSlot {
  id: string;
  /** Local wall-clock time, `HH:MM`. */
  time: string;
  label?: string;
}

export type MedicationStatus = 'active' | 'paused' | 'stopped' | 'prn';

export interface Medication {
  id: string;
  petId: string;
  name: string;
  strength?: string;
  form?: string;
  ingredient?: string;
  /** Plain-language amount per dose, e.g. "1 tablet". */
  doseLabel: string;
  route: 'oral' | 'topical' | 'transdermal' | 'inhalation' | 'injection';
  schedule: ScheduleSlot[];
  status: MedicationStatus;
  startedOn: string;
  stoppedOn?: string;
  stopReason?: string;
  prescriberId?: string;
  notes?: string;
  addedBy?: string;
}

export type CareStatus = 'taken' | 'skipped' | 'missed';

export interface CareLog {
  id: string;
  petId: string;
  kind: 'medication' | 'symptom' | 'weight' | 'note';
  medicationId?: string;
  slotId?: string;
  /** Local calendar day the event belonged to. */
  day: string;
  scheduledTime?: string;
  status?: CareStatus;
  symptom?: string;
  severity?: 'mild' | 'moderate' | 'severe';
  valueKg?: number;
  note?: string;
  recordedAt: string;
  recordedBy: string;
}

export type ExposureStatus = 'reported' | 'vet_contacted' | 'resolved';

export interface Exposure {
  id: string;
  petId: string;
  toxinId: string;
  toxinName: string;
  product?: string;
  amountValue?: number;
  amountUnit?: AmountUnit;
  observedAt: string;
  reportedAt: string;
  verdict: Verdict;
  headline: string;
  dosePerKg?: number;
  doseUnit?: string;
  symptoms: Symptom[];
  status: ExposureStatus;
  note?: string;
  assessedBy: string;
}

export interface OutboxItem {
  id: string;
  createdAt: string;
  channel: 'sms' | 'email' | 'voice';
  to: string;
  body: string;
  status: 'queued' | 'sent' | 'failed';
  sentAt?: string;
  error?: string;
  createdBy: string;
}

export interface Confirmation {
  /** sha256 of the token handed to the caller; the raw token is never stored. */
  tokenHash: string;
  action: string;
  payload: unknown;
  clientId: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail?: string;
}

export interface Household {
  id: string;
  name: string;
  timezone: string;
  address?: string;
  ownerId: string;
  sitterIds: string[];
}

export interface Database {
  household: Household;
  people: Person[];
  pets: Pet[];
  clinics: Clinic[];
  medications: Medication[];
  careLogs: CareLog[];
  exposures: Exposure[];
  outbox: OutboxItem[];
  confirmations: Confirmation[];
  audit: AuditEntry[];
}

export interface CareSlot {
  petId: string;
  petName: string;
  medicationId: string;
  medicationName: string;
  strength?: string;
  doseLabel: string;
  slotId?: string;
  scheduledTime: string;
  scheduledFor: string;
  status: CareStatus | 'due' | 'upcoming';
  recordedAt?: string;
  recordedBy?: string;
}

export interface CareSummary {
  day: string;
  pet: string;
  taken: number;
  skipped: number;
  missed: number;
  due: number;
  upcoming: number;
  slots: CareSlot[];
  prn: Array<{
    petName: string;
    medicationName: string;
    strength?: string;
    doseLabel: string;
    instructions: string;
  }>;
  asOf: string;
}

export interface ExposureAssessment {
  pet: {
    id?: string;
    name: string;
    species: Species | 'unknown';
    weightKg?: number;
  };
  toxin: {
    id: string;
    name: string;
    category: ToxinCategory;
    product?: string;
  };
  amount?: {
    value: number;
    unit: AmountUnit;
    normalised?: string;
  };
  intent: 'ingested' | 'considering';
  verdict: Verdict;
  headline: string;
  summary: string;
  dosePerKg?: number;
  doseUnit?: string;
  threshold?: {
    at: number;
    label: string;
    verdict: Verdict;
    detail?: string;
  };
  nextThreshold?: {
    at: number;
    label: string;
    verdict: Verdict;
  };
  /** Every published band, for the dose scale in the UI. */
  scale?: Array<{
    at: number;
    label: string;
    verdict: Verdict;
  }>;
  anyAmountRule?: boolean;
  escalation?: {
    reason: string;
    from: Verdict;
    to: Verdict;
  };
  findings: ExposureFinding[];
  signs: string[];
  firstAid: string[];
  contacts: {
    primary?: { name: string; phone: string; hours?: string };
    emergency?: { name: string; phone: string; address?: string };
    poisonControl: { name: string; phone: string; note?: string };
  };
  assumptions: string[];
  limitations: string[];
  checkedAt: string;
  latencyMs: number;
}

export interface ExposureFinding {
  severity: 'critical' | 'urgent' | 'watch' | 'info';
  title: string;
  detail: string;
  evidence: {
    source: 'curated' | 'record' | 'symptom';
    publisher?: string;
    title?: string;
    url?: string;
    quote?: string;
    accessed?: string;
  };
}
