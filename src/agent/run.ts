import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Client } from '@modelcontextprotocol/client';
import { config } from '../config.js';
import { runBedrockAgent, type ChatTurn } from './bedrock.js';
import type { AgentResult } from './mcp.js';
import { runScriptedAgent, type ScriptedContext, type ScriptedState } from './scripted.js';

export function hasAwsCredentials(): boolean {
  if (process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE || process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI) return true;
  return existsSync(path.join(os.homedir(), '.aws', 'credentials'));
}

/**
 * Prefer Bedrock when credentials exist; otherwise run the deterministic demo
 * agent. Both paths call the same MCP tools over Streamable HTTP — only the
 * planner differs, and the UI labels which one answered.
 */
export async function runAgent(options: {
  client: Client;
  message: string;
  history: ChatTurn[];
  context: ScriptedContext;
  scriptedState: ScriptedState;
}): Promise<AgentResult> {
  const forced = process.env.VETWISE_AGENT;
  const useBedrock = forced === 'bedrock' || (forced !== 'scripted' && hasAwsCredentials());

  if (useBedrock) {
    try {
      return await runBedrockAgent({
        client: options.client,
        message: options.message,
        history: options.history,
        context: options.context,
      });
    } catch (error) {
      // Log the cause for the operator; tell the caregiver only that the model
      // path failed, never with SDK or filesystem detail.
      console.error('[vetwise] Bedrock agent failed, falling back to the scripted planner:', error);
      const fallback = await runScriptedAgent({
        client: options.client,
        message: options.message,
        context: options.context,
        state: options.scriptedState,
      });
      return {
        ...fallback,
        reply: `${fallback.reply}\n\n(The Bedrock agent was unavailable, so this answer came from the deterministic planner.)`,
      };
    }
  }

  return runScriptedAgent({
    client: options.client,
    message: options.message,
    context: options.context,
    state: options.scriptedState,
  });
}

export const agentMode = (): 'bedrock' | 'scripted' => {
  const forced = process.env.VETWISE_AGENT;
  if (forced === 'bedrock' || forced === 'scripted') return forced;
  return hasAwsCredentials() ? 'bedrock' : 'scripted';
};

export const agentModel = (): string => config.bedrock.modelId;
