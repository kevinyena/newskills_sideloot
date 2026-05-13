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

/** Server-side tools Claude can use during a call. */
export interface ClaudeTools {
  /** Enable Anthropic's web_search server tool (`web_search_20260209`). */
  webSearch?: boolean;
}

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
  /** Optional server-side tools (web search, etc.). */
  tools?: ClaudeTools;
}

function buildTools(tools: ClaudeTools | undefined) {
  if (!tools) return undefined;
  const out: Array<Record<string, unknown>> = [];
  if (tools.webSearch) out.push({ type: 'web_search_20260209', name: 'web_search' });
  return out.length ? out : undefined;
}

export async function callClaude<T>({
  system = DEFAULT_SYSTEM,
  userMessage,
  schema,
  effort = 'high',
  maxTokens = 16000,
  tools,
}: CallClaudeOpts<T>): Promise<T> {
  const builtTools = buildTools(tools);

  // Always stream: the SDK refuses non-streaming requests that may exceed 10 min,
  // which happens with adaptive thinking + web_search + structured outputs.
  // Streaming also keeps the HTTP connection alive cleanly during long generations.
  const stream = getClient().messages.stream({
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
    // Cast: tool union types in the SDK are large; the wire format is stable.
    ...(builtTools ? { tools: builtTools as unknown as never } : {}),
  });

  const finalMessage = await stream.finalMessage();

  // With output_config.format set, the SDK populates parsed_output on the
  // final message (same behavior as messages.parse() in non-streaming mode).
  const maybeParsed = (finalMessage as unknown as { parsed_output?: T }).parsed_output;
  if (maybeParsed !== undefined && maybeParsed !== null) {
    return maybeParsed;
  }

  // Fallback: extract JSON from text blocks and validate against the schema.
  const text = finalMessage.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('');
  if (!text) {
    throw new Error(
      `Claude n'a pas retourné de contenu texte (stop_reason=${finalMessage.stop_reason ?? '?'}).`,
    );
  }
  try {
    return schema.parse(JSON.parse(text));
  } catch (e) {
    throw new Error(
      `Réponse Claude non parseable: ${(e as Error).message}\nDébut: ${text.slice(0, 400)}`,
    );
  }
}
