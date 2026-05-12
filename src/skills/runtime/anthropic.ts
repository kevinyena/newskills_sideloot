import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';

/**
 * Thin wrapper around the Anthropic SDK for skills that call Claude.
 *
 * Defaults:
 *  - Model: claude-opus-4-7
 *  - Adaptive thinking enabled
 *  - Structured outputs via Zod schema (response is validated by the SDK)
 *  - cache_control on the system block (no-op below the 4096-token threshold but
 *    forward-compatible for longer personas)
 */

export const CLAUDE_MODEL = 'claude-opus-4-7';
export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

// Lazy-init: ESM imports are hoisted before dotenv.config() runs in server.ts.
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

const DEFAULT_SYSTEM =
  "Tu es un expert créatif et stratégique. Tu réponds STRICTEMENT selon le schéma JSON demandé, sans préambule ni markdown autour. Tu suis les instructions de l'utilisateur à la lettre.";

export interface CallClaudeOpts<T> {
  /** Stable persona/rules. Defaults to a generic JSON-strict instruction. */
  system?: string;
  /** Rendered prompt with variables substituted. */
  userMessage: string;
  /** Zod schema. The SDK guarantees the response matches. */
  schema: z.ZodType<T>;
  /** Thinking depth + token spend. Default: 'high'. */
  effort?: ClaudeEffort;
  maxTokens?: number;
}

export async function callClaude<T>({
  system = DEFAULT_SYSTEM,
  userMessage,
  schema,
  effort = 'high',
  maxTokens = 16000,
}: CallClaudeOpts<T>): Promise<T> {
  const response = await getClient().messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    output_config: {
      format: zodOutputFormat(schema),
      effort,
    },
    system: [
      {
        type: 'text',
        text: system,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMessage }],
  });

  if (!response.parsed_output) {
    throw new Error(
      `Claude n'a pas retourné de sortie structurée (stop_reason=${response.stop_reason}).`,
    );
  }
  return response.parsed_output;
}
