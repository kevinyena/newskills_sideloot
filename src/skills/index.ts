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
import { CreateBusinessIdeaSkill } from './video_ugc/CreateBusinessIdeaSkill.js';
import { GenerateVideoScriptSkill } from './video_ugc/GenerateVideoScriptSkill.js';
import { AdaptToVeoPromptSkill } from './video_ugc/AdaptToVeoPromptSkill.js';
import { GenerateVeoVideoSkill } from './video_ugc/GenerateVeoVideoSkill.js';
import { PickNewsletterTopicSkill } from './newsletter/PickNewsletterTopicSkill.js';
import { GenerateNewsletterSkill } from './newsletter/GenerateNewsletterSkill.js';
import { CreateProspectableBusinessSkill } from './prospection/CreateProspectableBusinessSkill.js';
import { ChooseProspectionSkill } from './prospection/ChooseProspectionSkill.js';
import { CreateLocalBusinessSkill } from './maps_grounding/CreateLocalBusinessSkill.js';
import { FetchMapsProspectsSkill } from './maps_grounding/FetchMapsProspectsSkill.js';

export { type BaseSkill, type SkillContext, type SkillType } from './BaseSkill.js';
export { renderTemplate } from './runtime/render.js';
export * as veo from './runtime/veo.js';
export {
  CreateBusinessIdeaSkill,
  GenerateVideoScriptSkill,
  AdaptToVeoPromptSkill,
  GenerateVeoVideoSkill,
  PickNewsletterTopicSkill,
  GenerateNewsletterSkill,
  CreateProspectableBusinessSkill,
  ChooseProspectionSkill,
  CreateLocalBusinessSkill,
  FetchMapsProspectsSkill,
};

/** All registered skills. New skills: import + add here. */
export const ALL_SKILLS: ReadonlyArray<BaseSkill> = [
  new CreateBusinessIdeaSkill(),
  new GenerateVideoScriptSkill(),
  new AdaptToVeoPromptSkill(),
  new GenerateVeoVideoSkill(),
  new PickNewsletterTopicSkill(),
  new GenerateNewsletterSkill(),
  new CreateProspectableBusinessSkill(),
  new ChooseProspectionSkill(),
  new CreateLocalBusinessSkill(),
  new FetchMapsProspectsSkill(),
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
 * Display config per `category`. When a new category appears in `ALL_SKILLS`,
 * add an entry here to control its display name + icon + position in the sidebar.
 * Unknown categories fall back to a generic auto-generated display.
 */
const CATEGORY_DISPLAY: Record<string, { name: string; icon: string; order: number }> = {
  video_ugc: { name: 'Video UGC', icon: '🎬', order: 1 },
  newsletter: { name: 'Newsletter', icon: '📨', order: 2 },
  prospection: { name: 'Choose Prospection', icon: '🎯', order: 3 },
  maps_grounding: { name: 'Maps Grounding', icon: '🗺️', order: 4 },
};

function defaultDisplay(category: string, fallbackOrder: number) {
  // Convert snake_case / kebab-case → "Title Case" as a sensible default.
  const name = category
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return { name, icon: '✨', order: 99 + fallbackOrder };
}

/**
 * Build the UI section tree by grouping skills on their `category` field.
 * Skills are sorted by `order` within each section; sections are sorted by
 * the order defined in `CATEGORY_DISPLAY`.
 */
export function buildSections(
  skills: ReadonlyArray<BaseSkill> = ALL_SKILLS,
): SerializedSection[] {
  const byCategory = new Map<string, SerializedSkill[]>();
  for (const skill of skills) {
    const s = serializeSkill(skill);
    const arr = byCategory.get(s.category) ?? [];
    arr.push(s);
    byCategory.set(s.category, arr);
  }

  let fallbackOrder = 0;
  const sections: SerializedSection[] = [];
  for (const [category, list] of byCategory) {
    const display = CATEGORY_DISPLAY[category] ?? defaultDisplay(category, fallbackOrder++);
    list.sort((a, b) => a.order - b.order);
    sections.push({
      id: category,
      name: display.name,
      icon: display.icon,
      order: display.order,
      skills: list,
    });
  }
  sections.sort((a, b) => a.order - b.order);
  return sections;
}
