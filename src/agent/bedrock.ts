import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Message,
  type Tool,
} from '@aws-sdk/client-bedrock-runtime';
import type { Client } from '@modelcontextprotocol/client';
import { config } from '../config.js';
import { SAFETY_INSTRUCTIONS } from '../mcp/server.js';
import { callTool, type AgentResult, type AgentStep } from './mcp.js';
import type { ScriptedContext } from './scripted.js';

/** Enough for read → assess → log → alert, with one retry each. */
const MAX_TURNS = 10;

/**
 * A failed call to one of these means the answer cannot be trusted: the model
 * must not be allowed to carry on and describe an assessment that never ran.
 */
const SAFETY_CRITICAL = new Set(['assess_toxin_exposure', 'log_care_event', 'apply_record_change', 'alert_caregiver']);

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

function systemPrompt(context: ScriptedContext): string {
  const pets = context.pets.map((pet) => `${pet.name} (${pet.species}, ${pet.weightKg} kg)`).join('; ');
  return [
    SAFETY_INSTRUCTIONS,
    '',
    `You are speaking as a household pet-safety assistant for ${context.ownerName}'s home. The pets are ${pets}.`,
    `The person may be ${context.ownerName} (owner) or ${context.sitterName} (pet sitter).`,
    'Voice first: short sentences, no markdown, no lists read aloud.',
    'When a tool returns veterinary evidence, say what it says in plain words and name the source once ("the Merck Veterinary Manual").',
    'If the person describes an exposure, call assess_toxin_exposure before answering — even if you are confident.',
    'If a change to the record is needed, call propose_record_change and then ask for a spoken yes. Only call apply_record_change after they say yes.',
  ].join('\n');
}

function toTools(tools: Awaited<ReturnType<Client['listTools']>>['tools']): Tool[] {
  return tools.map((tool) => ({
    toolSpec: {
      name: tool.name,
      description: tool.description ?? tool.name,
      inputSchema: { json: (tool.inputSchema ?? { type: 'object', properties: {} }) as never },
    },
  }));
}

/**
 * Turn the stored session into Bedrock's own multi-turn shape.
 *
 * The previous version flattened the transcript into one string, so a message
 * containing "System: ..." became part of the instruction text. Here every
 * earlier exchange is a separate message with a fixed role, and the new
 * caregiver message is its own user turn — there is no string to inject into.
 */
function toMessages(history: ChatTurn[], message: string): Message[] {
  const messages: Message[] = [];
  for (const turn of history) {
    const role = turn.role === 'assistant' ? 'assistant' : 'user';
    const last = messages.at(-1);
    // Converse rejects two consecutive turns from the same role.
    if (last && last.role === role) {
      last.content = [...(last.content ?? []), { text: turn.text }];
      continue;
    }
    messages.push({ role, content: [{ text: turn.text }] });
  }
  const last = messages.at(-1);
  if (last && last.role === 'user') last.content = [...(last.content ?? []), { text: message }];
  else messages.push({ role: 'user', content: [{ text: message }] });
  return messages;
}

function handoff(context: ScriptedContext): string {
  const poison = context.poisonControl;
  return poison
    ? `I could not finish that assessment in the steps I am allowed. Do not wait on me — call ${poison.name} at ${poison.phone}, or your veterinarian, now.`
    : 'I could not finish that assessment in the steps I am allowed. Do not wait on me — call your veterinarian or poison control now.';
}

export async function runBedrockAgent(options: {
  client: Client;
  message: string;
  history: ChatTurn[];
  context: ScriptedContext;
}): Promise<AgentResult> {
  const runtime = new BedrockRuntimeClient({ region: config.bedrock.region });
  const { tools } = await options.client.listTools();
  const toolConfig = { tools: toTools(tools) };
  const steps: AgentStep[] = [];
  const messages = toMessages(options.history, options.message);

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const response = await runtime.send(
      new ConverseCommand({
        modelId: config.bedrock.modelId,
        system: [{ text: systemPrompt(options.context) }],
        messages,
        toolConfig,
        inferenceConfig: { maxTokens: 700, temperature: 0.2 },
      }),
    );

    const message = response.output?.message;
    if (!message) throw new Error('Bedrock returned no message.');
    messages.push(message);

    const toolUses = (message.content ?? []).filter(
      (block): block is ContentBlock.ToolUseMember => 'toolUse' in block && !!block.toolUse,
    );

    if (response.stopReason !== 'tool_use' || toolUses.length === 0) {
      const reply = (message.content ?? [])
        .map((block) => ('text' in block ? block.text ?? '' : ''))
        .join(' ')
        .trim();
      return { reply: reply || 'I did not get an answer back. Try asking again.', steps, provider: 'bedrock' };
    }

    const results: ContentBlock[] = [];
    for (const use of toolUses) {
      const name = use.toolUse!.name ?? 'unknown';
      const args = (use.toolUse!.input ?? {}) as Record<string, unknown>;
      try {
        const outcome = await callTool(options.client, name, args);
        steps.push({
          tool: name,
          args,
          ok: outcome.ok,
          text: outcome.text,
          ...(outcome.structured !== undefined ? { structured: outcome.structured } : {}),
        });
        results.push({
          toolResult: {
            toolUseId: use.toolUse!.toolUseId,
            status: outcome.ok ? 'success' : 'error',
            content: outcome.structured !== undefined ? [{ json: outcome.structured as never }] : [{ text: outcome.text }],
          },
        });
      } catch (error) {
        const text = `Tool failed: ${(error as Error).message}`;
        steps.push({ tool: name, args, ok: false, text });
        if (SAFETY_CRITICAL.has(name)) {
          // Stop the loop: a failed safety call must not become a spoken
          // assessment. The caller gets the hand-off line instead.
          console.error(`[vetwise] safety-critical tool ${name} threw:`, error);
          return { reply: handoff(options.context), steps, provider: 'bedrock' };
        }
        results.push({ toolResult: { toolUseId: use.toolUse!.toolUseId, status: 'error', content: [{ text }] } });
      }
    }

    messages.push({ role: 'user', content: results });
  }

  return { reply: handoff(options.context), steps, provider: 'bedrock' };
}

/**
 * Fail at boot, not on the first caregiver message.
 *
 * `VETWISE_AGENT=bedrock` is an explicit operator choice, so a missing or
 * expired credential should stop the process rather than surface as a 502
 * during an emergency.
 */
export async function assertBedrockReady(): Promise<void> {
  const runtime = new BedrockRuntimeClient({ region: config.bedrock.region });
  try {
    await runtime.send(
      new ConverseCommand({
        modelId: config.bedrock.modelId,
        messages: [{ role: 'user', content: [{ text: 'ping' }] }],
        inferenceConfig: { maxTokens: 1 },
      }),
    );
    console.log(`[vetwise] Bedrock reachable (${config.bedrock.modelId}, ${config.bedrock.region}).`);
  } catch (error) {
    throw new Error(
      `Bedrock is not usable with the current credentials (${config.bedrock.modelId}, ${config.bedrock.region}): ` +
        `${(error as Error).message}. Fix the credentials, or start with VETWISE_AGENT=scripted.`,
    );
  }
}
