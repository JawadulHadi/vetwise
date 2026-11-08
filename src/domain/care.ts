import { atLocalTime, minutesUntil, now, todayKey } from '../clock.js';
import { newId } from '../store/store.js';
import type {
  CareLog,
  CareSlot,
  CareSummary,
  CareStatus,
  Database,
  Medication,
  MedicationStatus,
  Person,
  Pet,
} from './types.js';

const LATE_AFTER_MINUTES = 120;
const UPCOMING_AFTER_MINUTES = 30;

export function petName(db: Database, petId: string): string {
  return db.pets.find((pet) => pet.id === petId)?.name ?? 'your pet';
}

export function findPet(db: Database, needle: string): Pet | undefined {
  const value = needle.trim().toLowerCase();
  if (!value) return undefined;
  return (
    db.pets.find((pet) => pet.id === needle) ??
    db.pets.find((pet) => pet.name.toLowerCase() === value) ??
    db.pets.find((pet) => pet.name.toLowerCase().startsWith(value)) ??
    db.pets.find((pet) => value.startsWith(pet.name.toLowerCase()))
  );
}

export function peopleFor(db: Database): Person[] {
  return db.people;
}

export function findPerson(db: Database, needle: string): Person | undefined {
  const value = needle.trim().toLowerCase();
  if (!value) return undefined;
  return (
    db.people.find((person) => person.id === needle) ??
    db.people.find((person) => person.name.toLowerCase() === value) ??
    db.people.find((person) => person.name.toLowerCase().split(/\s+/).some((part) => part === value)) ??
    db.people.find((person) => person.name.toLowerCase().startsWith(value))
  );
}

export function owner(db: Database): Person | undefined {
  return db.people.find((person) => person.id === db.household.ownerId);
}

export function activeMedications(db: Database, petId?: string): Medication[] {
  return db.medications.filter(
    (medication) =>
      (!petId || medication.petId === petId) && (medication.status === 'active' || medication.status === 'prn'),
  );
}

export function scheduledMedications(db: Database, petId?: string): Medication[] {
  return db.medications.filter(
    (medication) => (!petId || medication.petId === petId) && medication.status === 'active' && medication.schedule.length > 0,
  );
}

export function findMedication(db: Database, needle: string, petId?: string): Medication | undefined {
  const value = needle.trim().toLowerCase();
  if (!value) return undefined;
  const pool = db.medications.filter((medication) => !petId || medication.petId === petId);
  return (
    pool.find((medication) => medication.id === needle) ??
    pool.find((medication) => medication.name.toLowerCase() === value) ??
    pool.find((medication) => value.startsWith(medication.name.toLowerCase())) ??
    pool.find((medication) => medication.name.toLowerCase().startsWith(value))
  );
}

export function listMedications(
  db: Database,
  options: { petId?: string; status?: 'active' | 'all' | 'stopped' | 'prn' } = {},
): Medication[] {
  const status = options.status ?? 'active';
  return db.medications.filter((medication) => {
    if (options.petId && medication.petId !== options.petId) return false;
    if (status === 'all') return true; // Fixed: "all" really means every status.
    if (status === 'stopped') return medication.status === 'stopped';
    if (status === 'prn') return medication.status === 'prn';
    return medication.status === 'active' || medication.status === 'prn';
  });
}

export function medicationLabel(medication: Medication): string {
  return `${medication.name}${medication.strength ? ` ${medication.strength}` : ''}`;
}

export function scheduleLabel(medication: Medication): string {
  return medication.schedule.length > 0 ? medication.schedule.map((slot) => slot.time).join(', ') : 'as needed';
}

export function prescriberName(db: Database, medication: Medication): string | undefined {
  if (!medication.prescriberId) return undefined;
  return db.clinics.find((clinic) => clinic.id === medication.prescriberId)?.name;
}

export function statusForSlot(
  db: Database,
  medication: Medication,
  slotId: string,
  day: string,
  at: Date = now(),
): { status: CareStatus | 'due' | 'upcoming'; log?: CareLog } {
  const log = db.careLogs.find(
    (entry) => entry.kind === 'medication' && entry.medicationId === medication.id && entry.day === day && entry.slotId === slotId,
  );
  if (log?.status) return { status: log.status, log };

  const slot = medication.schedule.find((entry) => entry.id === slotId);
  if (!slot) return { status: 'upcoming' };
  const scheduledFor = atLocalTime(day, slot.time);
  const delta = minutesUntil(scheduledFor, at);
  if (delta > UPCOMING_AFTER_MINUTES) return { status: 'upcoming' };
  if (delta >= -LATE_AFTER_MINUTES) return { status: 'due' };
  return { status: 'missed' };
}

export function careSummary(db: Database, day: string = todayKey(), petId?: string): CareSummary {
  const at = now();
  const slots: CareSlot[] = [];

  for (const medication of scheduledMedications(db, petId)) {
    for (const slot of medication.schedule) {
      const { status, log } = statusForSlot(db, medication, slot.id, day, at);
      slots.push({
        petId: medication.petId,
        petName: petName(db, medication.petId),
        medicationId: medication.id,
        medicationName: medication.name,
        ...(medication.strength ? { strength: medication.strength } : {}),
        doseLabel: medication.doseLabel,
        slotId: slot.id,
        scheduledTime: slot.time,
        scheduledFor: atLocalTime(day, slot.time),
        status,
        ...(log?.recordedAt ? { recordedAt: log.recordedAt } : {}),
        ...(log?.recordedBy ? { recordedBy: log.recordedBy } : {}),
      });
    }
  }

  slots.sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  const count = (status: CareSlot['status']) => slots.filter((slot) => slot.status === status).length;

  const prn = db.medications
    .filter((medication) => (!petId || medication.petId === petId) && medication.status === 'prn')
    .map((medication) => ({
      petName: petName(db, medication.petId),
      medicationName: medication.name,
      ...(medication.strength ? { strength: medication.strength } : {}),
      doseLabel: medication.doseLabel,
      instructions: medication.notes ?? medication.doseLabel,
    }));

  return {
    day,
    pet: petId ? petName(db, petId) : 'All pets',
    taken: count('taken'),
    skipped: count('skipped'),
    missed: count('missed'),
    due: count('due'),
    upcoming: count('upcoming'),
    slots,
    prn,
    asOf: at.toISOString(),
  };
}

export function nextDueSlot(summary: CareSummary): CareSlot | undefined {
  return summary.slots.find((slot) => slot.status === 'due') ?? summary.slots.find((slot) => slot.status === 'upcoming');
}

export function describeSlot(slot: CareSlot): string {
  const time = new Date(slot.scheduledFor).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${slot.petName}: ${slot.medicationName}${slot.strength ? ` ${slot.strength}` : ''} at ${time}`;
}

export interface LogCareInput {
  petId: string;
  kind: 'medication' | 'symptom' | 'weight' | 'note';
  medicationId?: string;
  slotId?: string;
  scheduledTime?: string;
  status?: 'taken' | 'skipped';
  symptom?: string;
  severity?: 'mild' | 'moderate' | 'severe';
  valueKg?: number;
  note?: string;
  day?: string;
  actor: string;
}

export interface LogCareResult {
  event: CareLog;
  message: string;
  updatedPet?: Pet;
}

export class CareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CareError';
  }
}

/**
 * Log a care event. The slot must be unambiguous: if the medication has more
 * than one unlogged slot today and no time was supplied, this throws instead of
 * silently picking the first one.
 */
export function logCareEvent(db: Database, input: LogCareInput): LogCareResult {
  const pet = db.pets.find((entry) => entry.id === input.petId);
  if (!pet) throw new CareError(`No pet with id "${input.petId}" is on file.`);
  const day = input.day ?? todayKey();
  const recordedAt = now().toISOString();

  if (input.kind === 'medication') {
    if (!input.medicationId) throw new CareError('A medication is required for a medication log.');
    const medication = db.medications.find((entry) => entry.id === input.medicationId && entry.petId === pet.id);
    if (!medication) throw new CareError(`That medication is not on ${pet.name}’s record.`);
    if (medication.schedule.length === 0) throw new CareError(`${medication.name} is not scheduled, so there is no dose slot to log.`);

    let slot = input.slotId
      ? medication.schedule.find((entry) => entry.id === input.slotId)
      : input.scheduledTime
        ? medication.schedule.find((entry) => entry.time === input.scheduledTime)
        : undefined;

    if (!slot) {
      const unlogged = medication.schedule.filter(
        (entry) => !db.careLogs.some((log) => log.medicationId === medication.id && log.day === day && log.slotId === entry.id),
      );
      if (unlogged.length === 1) slot = unlogged[0]!;
      else if (unlogged.length === 0) throw new CareError(`${medication.name} already has every dose logged for ${day}.`);
      else
        throw new CareError(
          `${medication.name} has ${unlogged.length} unlogged slots today (${unlogged.map((entry) => entry.time).join(', ')}). Tell me which time to log.`,
        );
    }
    if (!slot) throw new CareError(`${medication.name} has no dose slot to log.`);

    const status = input.status ?? 'taken';
    const existing = db.careLogs.find(
      (log) => log.medicationId === medication.id && log.day === day && log.slotId === slot!.id,
    );
    let event: CareLog;
    if (existing) {
      existing.status = status;
      existing.recordedAt = recordedAt;
      existing.recordedBy = input.actor;
      if (input.note) existing.note = input.note;
      event = existing;
    } else {
      event = {
        id: newId('care'),
        petId: pet.id,
        kind: 'medication',
        medicationId: medication.id,
        slotId: slot.id,
        day,
        scheduledTime: slot.time,
        status,
        recordedAt,
        recordedBy: input.actor,
        ...(input.note ? { note: input.note } : {}),
      };
      db.careLogs.push(event);
    }

    return {
      event,
      message: `Logged ${medication.name}${medication.strength ? ` ${medication.strength}` : ''} at ${slot.time} as ${status} for ${pet.name}.`,
    };
  }

  if (input.kind === 'weight') {
    if (!input.valueKg || input.valueKg <= 0) throw new CareError('A positive weight in kilograms is required.');
    pet.weightKg = input.valueKg;
    pet.weightUpdatedAt = recordedAt;
    const event: CareLog = {
      id: newId('care'),
      petId: pet.id,
      kind: 'weight',
      day,
      valueKg: input.valueKg,
      note: input.note,
      recordedAt,
      recordedBy: input.actor,
    };
    db.careLogs.push(event);
    return { event, message: `Recorded ${pet.name} at ${input.valueKg} kg.`, updatedPet: pet };
  }

  if (input.kind === 'symptom' && !input.symptom) throw new CareError('A symptom is required for a symptom log.');

  const event: CareLog = {
    id: newId('care'),
    petId: pet.id,
    kind: input.kind,
    day,
    ...(input.symptom ? { symptom: input.symptom } : {}),
    ...(input.severity ? { severity: input.severity } : {}),
    ...(input.note ? { note: input.note } : {}),
    recordedAt,
    recordedBy: input.actor,
  };
  db.careLogs.push(event);

  return {
    event,
    message:
      input.kind === 'symptom'
        ? `Logged ${pet.name}: ${input.symptom}${input.severity ? ` (${input.severity})` : ''}.`
        : `Added a note for ${pet.name}.`,
  };
}

export function medicationStatusLabel(status: MedicationStatus): string {
  return { active: 'active', paused: 'paused', stopped: 'stopped', prn: 'as needed' }[status];
}
