import type { z } from 'zod';

/**
 * Runtime context handed to a skill at execution time.
 *
 * The shape is **compatible with Mintery's BaseSkill** (apps/core_app/worker/src/skills/BaseSkill.ts)
 * so a skill written here drops into Mintery without modification.
 */
export interface SkillContext {
  agentId?: string;
  ownerId?: string | null;
  businessId?: string | null;
  positionId?: string | null;
  taskId?: string | null;
}

export type SkillType = 'llm' | 'api';

/**
 * Base interface for ALL agent skills.
 *
 * Required fields (`name`, `description`, `schema`, `execute`) match Mintery's
 * interface 1:1 — drop a skill from `src/skills/` into Mintery's worker and it works.
 *
 * Optional fields below are **additive UI metadata** consumed by the host app's
 * `/api/skills` registry endpoint. Mintery ignores them.
 */
export interface BaseSkill<TInput = any, TOutput = any> {
  /** Technical ID, snake_case. Used as the tool name when surfaced to an LLM. */
  name: string;

  /** Short description — also used as the tool description for an LLM. */
  description: string;

  /** Zod schema for input validation. The runtime calls `schema.parse(rawInput)` before `execute`. */
  schema: z.ZodTypeAny;

  /** The actual execution. Performs the side-effect and returns the typed output. */
  execute(input: TInput, ctx?: SkillContext): Promise<TOutput>;

  // -------- Optional UI metadata (ignored by Mintery) --------

  /** Friendlier display name shown in UI cards. Falls back to `name` if absent. */
  displayName?: string;

  /** Group skills in the UI sidebar (e.g. 'creative', 'media'). */
  category?: string;

  /** Sort order within the category. */
  order?: number;

  /** Surface differentiation: `'llm'` calls an LLM, `'api'` calls an external API. */
  type?: SkillType;

  /** Model identifier shown in UI (e.g. 'claude-opus-4-7'). */
  model?: string;

  /** Prompt template with `{{var}}` placeholders. Surfaced verbatim in the UI for inspection. */
  prompt?: string;

  /** External endpoint identifier (e.g. 'veo-3.1-generate-preview'). */
  endpoint?: string;
}
