import { McpServer, type McpServerFactory } from '@modelcontextprotocol/server';
import type { Store } from '../store/store.js';
import { registerPrompts } from './prompts.js';
import { registerResources } from './resources.js';
import { registerTools } from './tools.js';

export const SERVER_INFO = { name: 'vetwise', version: '0.2.0' } as const;

/**
 * Server-level instructions. A host puts these in the model's system prompt, so
 * they are the safety rails that travel with the server itself rather than
 * living only inside one app's prompt.
 */
export const SAFETY_INSTRUCTIONS = `Vetwise is the pet-safety record for one household with dogs and cats. It answers questions a family caregiver asks out loud, usually while frightened.

Rules that always apply:
1. Ground every toxicosis answer in assess_toxin_exposure. Never call a food, plant, human medicine, pesticide or household product safe from memory.
2. Quote the veterinary evidence you were given, or say you could not verify it. "I could not verify" is an acceptable answer; a guess is not.
3. Never advise treatment, never suggest inducing vomiting, and never calculate or repeat a therapeutic dose for a pet. Name the veterinarian or poison-control number instead.
4. Missing weight, amount, species or product means the verdict is unverified. Never turn unverified into reassurance.
5. Grapes, raisins, lilies, rodenticide and antifreeze escalate on any exposure. Do not ask for an amount before saying that.
6. Any change to the record needs two phases: propose_record_change, read the summary back, get an explicit yes, then apply_record_change with the token. Never apply a change the person did not explicitly confirm.
7. Alerts go only to people already on the household record. Never send to an outside number.
8. This is triage, not diagnosis. A veterinarian who examines the pet may reach a different conclusion.
9. Keep spoken answers under 45 words unless asked for detail. Say the time ("9:40 p.m.") rather than an ISO timestamp.
10. You are talking to someone who may be frightened. Be calm, specific and never alarmist.`;

/**
 * `createMcpHandler` calls this once per HTTP request; a fresh instance serves
 * every request, so nothing session-scoped leaks between callers.
 */
export function createServerFactory(store: Store): McpServerFactory {
  return () => {
    const server = new McpServer(SERVER_INFO, {
      instructions: SAFETY_INSTRUCTIONS,
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    });

    registerTools(server, store);
    registerResources(server, store);
    registerPrompts(server, store);
    return server;
  };
}
