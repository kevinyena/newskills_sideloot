import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';

// Lazy-init: ESM imports are hoisted, so `new Anthropic()` at top level would run
// before dotenv.config() in server.ts. Defer until first call.
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

export const CLAUDE_MODEL = 'claude-opus-4-7';

export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface CallClaudeOpts<T> {
  /** Stable persona/rules. Optional — defaults to a generic JSON-strict instruction. */
  system?: string;
  /** Rendered prompt with variables substituted. */
  userMessage: string;
  /** Zod schema; the SDK guarantees the response matches. */
  schema: z.ZodType<T>;
  /** Thinking depth + token spend. Default: 'high'. */
  effort?: ClaudeEffort;
  maxTokens?: number;
}

const DEFAULT_SYSTEM =
  "Tu es un expert créatif et stratégique. Tu réponds STRICTEMENT selon le schéma JSON demandé, sans préambule ni markdown autour. Tu suis les instructions de l'utilisateur à la lettre.";

/**
 * Call Claude Opus 4.7 with adaptive thinking + structured outputs.
 *
 * Renders order is `system` → `messages`. The system block carries `cache_control`,
 * so once the same persona is reused enough times the prefix may be served from cache
 * (Opus 4.7 minimum cacheable prefix is 4096 tokens — short systems silently won't cache).
 */
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
