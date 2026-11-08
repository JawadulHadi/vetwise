import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { formatTime, now, todayKey } from '../clock.js';
import { careSummary, listMedications, petName } from '../domain/care.js';
import type { Store } from '../store/store.js';

/**
 * Prompts are the reusable, host-side entry points — the same "evening check-in"
 * and "something my pet ate" shapes a real pet-safety assistant would ship as
 * suggested actions.
 */
export function registerPrompts(server: McpServer, store: Store): void {
  server.registerPrompt(
    'evening_check_in',
    {
      title: 'Evening medication check-in',
      description: 'Review tonight’s doses, what is overdue, and the single most important thing the caregiver should do next.',
      argsSchema: z.object({
        pet: z.string().optional().describe('Optional pet name, for example "Mochi"'),
        focus: z.string().optional().describe('Optional focus, for example "the gabapentin"'),
      }),
    },
    ({ pet: petNeedle, focus }) => {
      const data = store.read((db) => {
        const pets = petNeedle ? db.pets.filter((pet) => pet.name.toLowerCase() === petNeedle.toLowerCase()) : db.pets;
        return {
          household: db.household.name,
          pets: pets.length > 0 ? pets : db.pets,
          care: careSummary(db, todayKey()),
          medications: listMedications(db, { status: 'all' }).map((medication) => ({
            pet: petName(db, medication.petId),
            name: medication.name,
            strength: medication.strength,
            doseLabel: medication.doseLabel,
            schedule: medication.schedule.map((slot) => slot.time),
            status: medication.status,
            notes: medication.notes,
          })),
        };
      });

      const pending = data.care.slots.filter((slot) => slot.status !== 'taken' && slot.status !== 'skipped');

      return {
        description: 'Evening care briefing',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: [
                `Give me a calm 30-second evening check-in for ${data.pets.map((pet) => `${pet.name} (${pet.species}, ${pet.weightKg} kg)`).join(' and ')}${focus ? `, focused on ${focus}` : ''}.`,
                '',
                `It is ${formatTime(now().toISOString())} on ${todayKey()}.`,
                `Today: ${data.care.taken} taken, ${data.care.missed} missed, ${data.care.due} due now, ${data.care.upcoming} upcoming.`,
                ...pending.map(
                  (slot) =>
                    `- ${formatTime(slot.scheduledFor)} ${slot.petName}: ${slot.medicationName}${slot.strength ? ` ${slot.strength}` : ''} — ${slot.status}`,
                ),
                '',
                'Medication list:',
                ...data.medications.map(
                  (medication) =>
                    `- ${medication.pet}: ${medication.name}${medication.strength ? ` ${medication.strength}` : ''} — ${medication.doseLabel} at ${medication.schedule.join(', ') || 'as needed'} (${medication.status})`,
                ),
                '',
                'Rules: call get_care_summary before answering. Be concise, never advise a dose change, never suggest inducing vomiting, and end with the single most important thing to do next. If something is wrong, name the vet or ASPCA APCC (888) 426-4435.',
              ].join('\n'),
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    'something_my_pet_ate',
    {
      title: 'Something my pet ate',
      description: 'Run the toxicosis workflow for a reported exposure and explain the verdict with cited evidence and the right phone number.',
      argsSchema: z.object({
        pet: z.string().describe('Which pet, for example "Mochi"'),
        substance: z.string().describe('What they got into'),
        amount: z.string().optional().describe('How much, if known'),
      }),
    },
    ({ pet, substance, amount }) => {
      const context = store.read((db) => ({
        pets: db.pets.map((entry) => ({
          name: entry.name,
          species: entry.species,
          weightKg: entry.weightKg,
          conditions: entry.conditions,
          allergies: entry.allergies,
        })),
        clinics: db.clinics.map((clinic) => ({ name: clinic.name, kind: clinic.kind, phone: clinic.phone })),
      }));

      return {
        description: 'Toxicosis triage workflow',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: [
                `${pet} may have eaten ${substance}${amount ? ` — about ${amount}` : ''}. Is this an emergency?`,
                '',
                'Household:',
                ...context.pets.map(
                  (entry) =>
                    `- ${entry.name}: ${entry.species}, ${entry.weightKg} kg. Conditions: ${entry.conditions.join(', ') || 'none'}. Allergies: ${entry.allergies.map((allergy) => allergy.substance).join(', ') || 'none'}.`,
                ),
                '',
                'Contacts:',
                ...context.clinics.map((clinic) => `- ${clinic.name} (${clinic.kind.replaceAll('_', ' ')}): ${clinic.phone}`),
                '',
                'Steps: call assess_toxin_exposure. If the amount, weight, species or product is unknown, the answer is unverified — do not reassure. Quote the evidence you were given. Never advise inducing vomiting or any home treatment. End by naming the exact clinic or poison-control number to call.',
              ].join('\n'),
            },
          },
        ],
      };
    },
  );
}
