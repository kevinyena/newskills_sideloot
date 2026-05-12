/**
 * Skills registry.
 *
 * Importing from this file is the single integration point: a host app
 * (this UI, Mintery's worker, or anything else) gets `ALL_SKILLS` and either
 * routes tool calls through them or surfaces them in a UI.
 *
 * The skills are Mintery-compatible: every required `BaseSkill` field is
 * present, and the additional UI fields (`displayName`, `category`, `prompt`…)
 * are optional and ignored by hosts that don't need them.
 */

import { z } from 'zod';
import type { BaseSkill } from './BaseSkill.js';
import { CreateBusinessIdeaSkill } from './creative/CreateBusinessIdeaSkill.js';
import { GenerateVideoScriptSkill } from './creative/GenerateVideoScriptSkill.js';
import { AdaptToVeoPromptSkill } from './creative/AdaptToVeoPromptSkill.js';
import { GenerateVeoVideoSkill } from './media/GenerateVeoVideoSkill.js';

export { type BaseSkill, type SkillContext, type SkillType } from './BaseSkill.js';
export { renderTemplate } from './runtime/render.js';
export * as veo from './runtime/veo.js';
export {
  CreateBusinessIdeaSkill,
  GenerateVideoScriptSkill,
  AdaptToVeoPromptSkill,
  GenerateVeoVideoSkill,
};

/** All registered skills. New skills: import + add here. */
export const ALL_SKILLS: ReadonlyArray<BaseSkill> = [
  new CreateBusinessIdeaSkill(),
  new GenerateVideoScriptSkill(),
  new AdaptToVeoPromptSkill(),
  new GenerateVeoVideoSkill(),
];

/** Look up a skill by its technical `name`. */
export function findSkill(name: string): BaseSkill | undefined {
  return ALL_SKILLS.find((s) => s.name === name);
}

// ----- UI serialization -----

export interface SerializedSkill {
  name: string;
  displayName: string;
  description: string;
  category: string;
  order: number;
  type: 'llm' | 'api';
  model: string | null;
  endpoint: string | null;
  prompt: string | null;
  /** JSON Schema derived from the Zod schema, for UI inspection. */
  inputSchema: unknown;
}

export interface SerializedSection {
  id: string;
  name: string;
  icon: string;
  order: number;
  skills: SerializedSkill[];
}

function safeToJsonSchema(schema: z.ZodTypeAny): unknown {
  try {
    // Zod 4 ships z.toJSONSchema. Older versions: skip.
    const z4 = z as unknown as { toJSONSchema?: (s: z.ZodTypeAny) => unknown };
    return z4.toJSONSchema?.(schema) ?? null;
  } catch {
    return null;
  }
}

export function serializeSkill(skill: BaseSkill): SerializedSkill {
  return {
    name: skill.name,
    displayName: skill.displayName ?? skill.name,
    description: skill.description,
    category: skill.category ?? 'uncategorized',
    order: skill.order ?? 99,
    type: skill.type ?? 'llm',
    model: skill.model ?? null,
    endpoint: skill.endpoint ?? null,
    prompt: skill.prompt ?? null,
    inputSchema: safeToJsonSchema(skill.schema),
  };
}

/**
 * Build the UI section tree.
 *
 * For now, all skills live under a single "AI UGC" workflow section,
 * sorted by `order`. The `category` field on each skill (`creative`, `media`)
 * is preserved as metadata for Mintery-side organization but is not used to
 * split sections in this UI.
 */
export function buildSections(
  skills: ReadonlyArray<BaseSkill> = ALL_SKILLS,
): SerializedSection[] {
  const serialized = skills
    .map(serializeSkill)
    .sort((a, b) => a.order - b.order);
  return [
    {
      id: 'ai-ugc',
      name: 'AI UGC',
      icon: '🎬',
      order: 1,
      skills: serialized,
    },
  ];
}
