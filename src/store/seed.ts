import { atLocalTime, now, todayKey } from '../clock.js';
import type { CareLog, Database } from '../domain/types.js';

/**
 * A deliberately ordinary demo household: two pets, three active medications,
 * one stopped medication, one as-needed medication, and a sitter who is not the
 * owner. The story starts at 21:40 with two doses still due.
 */
export function seedDatabase(db: Database): void {
  const today = todayKey();
  const bootIso = now().toISOString();

  db.household = {
    id: 'hh-chen-patel',
    name: 'The Chen–Patel house',
    timezone: 'America/Los_Angeles',
    address: '1420 Alder Street, Sacramento, CA',
    ownerId: 'maya',
    sitterIds: ['noah'],
  };

  db.people = [
    {
      id: 'maya',
      name: 'Maya Chen',
      role: 'owner',
      phone: '+1-916-555-0121',
      notes: 'Works late Tuesdays. Handles medication changes, refills, and vet appointments.',
    },
    {
      id: 'noah',
      name: 'Noah Patel',
      role: 'sitter',
      phone: '+1-916-555-0177',
      notes: 'Neighbor and designated pet sitter. Read, log, and notify access; no record changes.',
    },
  ];

  db.pets = [
    {
      id: 'mochi',
      name: 'Mochi',
      species: 'dog',
      breed: 'Pembroke Welsh Corgi',
      sex: 'male',
      neutered: true,
      ageYears: 5,
      weightKg: 13.6,
      weightUpdatedAt: atLocalTime(today, '08:00'),
      conditions: ['Intervertebral disc disease (managed)', 'Mild anxiety'],
      allergies: [{ substance: 'Chicken protein', reaction: 'Itchy skin and loose stool', severity: 'mild' }],
      microchip: '981020006712345',
      diet: '1/2 cup kibble twice daily. Gabapentin hidden in xylitol-free peanut butter.',
      notes: 'Short legs, big opinions. Will counter-surf if a chair is left out.',
    },
    {
      id: 'juniper',
      name: 'Juniper',
      species: 'cat',
      breed: 'Domestic Shorthair',
      sex: 'female',
      neutered: true,
      ageYears: 9,
      weightKg: 4.6,
      weightUpdatedAt: atLocalTime(today, '08:00'),
      conditions: ['Hyperthyroidism'],
      allergies: [],
      microchip: '981020006798765',
      diet: 'Half a 3 oz can twice daily, plus measured dry food.',
      notes: 'Indoor only. Will eat anything left on the counter, including flowers.',
    },
  ];

  db.clinics = [
    {
      id: 'cedar-creek',
      name: 'Cedar Creek Animal Hospital (Dr. Priya Raman)',
      kind: 'primary',
      phone: '+1-916-555-0142',
      address: '2180 Cedar Creek Way, Sacramento, CA',
      hours: 'Mon–Sat 8:00–18:00; closed Sunday',
      url: 'https://example.com/cedar-creek',
      notes: 'Primary vet for both pets. Call ahead for same-day sick visits.',
    },
    {
      id: 'svess',
      name: 'Sacramento Veterinary Emergency & Specialty',
      kind: 'emergency',
      phone: '+1-916-555-0199',
      address: '1450 Exposition Blvd, Sacramento, CA',
      hours: 'Open 24 hours',
      notes: 'Closest 24-hour emergency hospital. Call while you are on the way.',
    },
    {
      id: 'apcc',
      name: 'ASPCA Animal Poison Control Center',
      kind: 'poison_control',
      phone: '(888) 426-4435',
      url: 'https://www.aspca.org/pet-care/animal-poison-control',
      hours: 'Open 24 hours',
      notes: 'A consultation fee may apply. Have the product label and your pet’s weight ready.',
    },
    {
      id: 'pph',
      name: 'Pet Poison Helpline',
      kind: 'poison_control',
      phone: '(855) 764-7661',
      url: 'https://www.petpoisonhelpline.com/',
      hours: 'Open 24 hours',
      notes: 'A consultation fee may apply. Useful for a second opinion on a product label.',
    },
  ];

  db.medications = [
    {
      id: 'med-mochi-carprofen',
      petId: 'mochi',
      name: 'Carprofen',
      strength: '25 mg',
      form: 'chewable tablet',
      ingredient: 'carprofen',
      doseLabel: '1/2 tablet',
      route: 'oral',
      schedule: [{ id: 'carprofen-am', time: '08:00', label: 'Breakfast' }],
      status: 'active',
      startedOn: '2026-10-12',
      prescriberId: 'cedar-creek',
      notes: 'For arthritis pain. Give with food.',
      addedBy: 'maya',
    },
    {
      id: 'med-mochi-gabapentin',
      petId: 'mochi',
      name: 'Gabapentin',
      strength: '100 mg',
      form: 'capsule',
      ingredient: 'gabapentin',
      doseLabel: '1 capsule',
      route: 'oral',
      schedule: [{ id: 'gabapentin-pm', time: '21:00', label: 'Evening' }],
      status: 'active',
      startedOn: '2026-10-12',
      prescriberId: 'cedar-creek',
      notes: 'For anxiety and neuropathic pain. May cause sleepiness.',
      addedBy: 'maya',
    },
    {
      id: 'med-juniper-methimazole',
      petId: 'juniper',
      name: 'Methimazole',
      strength: '2.5 mg',
      form: 'tablet',
      ingredient: 'methimazole',
      doseLabel: '1 tablet',
      route: 'oral',
      schedule: [
        { id: 'methimazole-am', time: '08:00', label: 'Breakfast' },
        { id: 'methimazole-pm', time: '20:00', label: 'Evening' },
      ],
      status: 'active',
      startedOn: '2025-06-04',
      prescriberId: 'cedar-creek',
      notes: 'For hyperthyroidism. Do not crush; follow with a little food.',
      addedBy: 'maya',
    },
    {
      id: 'med-mochi-cerenia',
      petId: 'mochi',
      name: 'Maropitant (Cerenia)',
      strength: '16 mg',
      form: 'tablet',
      ingredient: 'maropitant',
      doseLabel: '1 tablet',
      route: 'oral',
      schedule: [],
      status: 'prn',
      startedOn: '2026-09-18',
      prescriberId: 'cedar-creek',
      notes: 'Only if the vet approves, for nausea or car sickness. Not a routine dose.',
      addedBy: 'maya',
    },
    {
      id: 'med-mochi-trazodone',
      petId: 'mochi',
      name: 'Trazodone',
      strength: '50 mg',
      form: 'tablet',
      ingredient: 'trazodone',
      doseLabel: '1/2 tablet',
      route: 'oral',
      schedule: [{ id: 'trazodone-pm', time: '20:00' }],
      status: 'stopped',
      startedOn: '2026-08-02',
      stoppedOn: '2026-10-20',
      stopReason: 'No longer needed for vet visits; Dr. Raman stopped it.',
      prescriberId: 'cedar-creek',
      notes: 'Was used before appointments.',
      addedBy: 'maya',
    },
  ];

  const taken = (medicationId: string, slotId: string, time: string, recordedTime: string, note?: string): CareLog => ({
    id: `log-${medicationId}-${slotId}-${today}`,
    petId: medicationId.includes('juniper') ? 'juniper' : 'mochi',
    kind: 'medication',
    medicationId,
    slotId,
    day: today,
    scheduledTime: time,
    status: 'taken',
    recordedAt: atLocalTime(today, recordedTime),
    recordedBy: 'maya',
    ...(note ? { note } : {}),
  });

  db.careLogs = [
    taken('med-juniper-methimazole', 'methimazole-am', '08:00', '08:05'),
    taken('med-mochi-carprofen', 'carprofen-am', '08:00', '08:12', 'With breakfast'),
    {
      id: `log-weight-mochi-${today}`,
      petId: 'mochi',
      kind: 'weight',
      day: today,
      valueKg: 13.6,
      recordedAt: atLocalTime(today, '08:00'),
      recordedBy: 'maya',
      note: 'Annual scale check at the clinic.',
    },
  ];

  db.exposures = [];
  db.outbox = [];
  db.confirmations = [];
  db.audit = [
    {
      id: 'audit-seed',
      at: bootIso,
      actor: 'system',
      action: 'database.seeded',
      detail: 'Demo household created: Maya, Noah, Mochi, and Juniper.',
    },
  ];
}
