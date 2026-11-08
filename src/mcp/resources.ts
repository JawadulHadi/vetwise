import { ResourceTemplate, type McpServer, type ServerContext } from '@modelcontextprotocol/server';
import { todayKey } from '../clock.js';
import { careSummary, findPet, listMedications, prescriberName } from '../domain/care.js';
import { TOXINS, findToxin } from '../domain/toxins.js';
import type { Store } from '../store/store.js';
import { requireScope, SCOPES } from './auth.js';

/**
 * Resources are read-only context a client can attach before the model speaks.
 * Tools answer questions; resources are what a host pre-loads so the first
 * answer is already grounded in the household record and the toxin catalogue.
 */
export function registerResources(server: McpServer, store: Store): void {
  server.registerResource(
    'household-profile',
    'vetwise://household',
    {
      title: 'Household profile',
      description: 'People and roles, every pet with species and weight, and the primary, emergency and poison-control clinics.',
      mimeType: 'application/json',
    },
    async (uri, ctx: ServerContext) => {
      requireScope(ctx, SCOPES.read);
      const profile = store.read((db) => ({
        household: db.household,
        people: db.people,
        pets: db.pets,
        clinics: db.clinics,
        timezone: db.household.timezone,
      }));
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(profile, null, 2) }] };
    },
  );

  server.registerResource(
    'one-pet',
    new ResourceTemplate('vetwise://pets/{petId}', { list: undefined }),
    {
      title: 'One pet',
      description: 'Full profile for a single pet, including stopped medications and today’s care status.',
      mimeType: 'application/json',
    },
    async (uri, variables, ctx: ServerContext) => {
      requireScope(ctx, SCOPES.read);
      const id = String(variables.petId);
      const data = store.read((db) => {
        const pet = findPet(db, id);
        if (!pet) throw new Error(`No pet with id ${id}`);
        return {
          pet,
          medications: listMedications(db, { petId: pet.id, status: 'all' }).map((medication) => ({
            ...medication,
            scheduleLabel:
              medication.schedule.length > 0 ? medication.schedule.map((slot) => slot.time).join(', ') : 'as needed',
            prescriber: prescriberName(db, medication),
          })),
          care: careSummary(db, todayKey(), pet.id),
        };
      });
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.registerResource(
    'todays-care',
    'vetwise://care/today',
    {
      title: 'Today’s care',
      description: 'Taken, missed, due and upcoming doses for every pet today.',
      mimeType: 'application/json',
    },
    async (uri, ctx: ServerContext) => {
      requireScope(ctx, SCOPES.read);
      const summary = store.read((db) => careSummary(db, todayKey()));
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(summary, null, 2) }] };
    },
  );

  server.registerResource(
    'medications',
    'vetwise://medications',
    {
      title: 'All medications',
      description: 'Every medication including stopped and as-needed medicines, with dose, schedule, status and prescriber.',
      mimeType: 'application/json',
    },
    async (uri, ctx: ServerContext) => {
      requireScope(ctx, SCOPES.read);
      const medications = store.read((db) =>
        listMedications(db, { status: 'all' }).map((medication) => ({
          ...medication,
          petName: db.pets.find((pet) => pet.id === medication.petId)?.name ?? 'Unknown pet',
          scheduleLabel: medication.schedule.length > 0 ? medication.schedule.map((slot) => slot.time).join(', ') : 'as needed',
          prescriber: prescriberName(db, medication),
        })),
      );
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(medications, null, 2) }] };
    },
  );

  server.registerResource(
    'toxin-catalogue',
    'vetwise://toxins',
    {
      title: 'Toxicosis catalogue',
      description: 'The curated toxin index: id, name, category, documented species and any-exposure verdict.',
      mimeType: 'application/json',
    },
    async (uri, ctx: ServerContext) => {
      requireScope(ctx, SCOPES.read);
      const index = TOXINS.map((toxin) => ({
        id: toxin.id,
        name: toxin.name,
        category: toxin.category,
        species: toxin.species,
        unitLabel: toxin.unitLabel,
        anyAmountVerdict: toxin.anyAmountVerdict ?? null,
        sourceCount: toxin.sources.length,
      }));
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(index, null, 2) }] };
    },
  );

  server.registerResource(
    'one-toxin',
    new ResourceTemplate('vetwise://toxins/{toxinId}', { list: undefined }),
    {
      title: 'One toxin record',
      description: 'Full thresholds, dose bands, signs, first aid and cited sources for one toxin.',
      mimeType: 'application/json',
    },
    async (uri, variables, ctx: ServerContext) => {
      requireScope(ctx, SCOPES.read);
      const id = String(variables.toxinId);
      const toxin = findToxin(id);
      if (!toxin) throw new Error(`No toxin with id ${id}`);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(toxin, null, 2) }] };
    },
  );
}
