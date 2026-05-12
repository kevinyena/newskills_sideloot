/**
 * Shared types used by both the server and the bundled client.
 *
 * Domain types (`Business`, `VideoScript`) mirror the Zod schemas defined
 * in `src/skills/creative/*Skill.ts` — keep them in sync if you change the
 * skill schemas.
 */

export type Language = 'fr' | 'en' | 'es' | 'de' | 'it' | 'pt';
export type AspectRatio = '9:16' | '16:9';

export interface Business {
  name: string;
  type: string;
  pitch: string;
  target: string;
}

export interface VideoScript {
  hook: string;
  concept: string;
  spokenLine: string;
  emotion?: string;
}

// ----- Skill registry (what `/api/skills` returns) -----

export type SkillTypeTag = 'llm' | 'api';

export interface SerializedSkill {
  name: string;
  displayName: string;
  description: string;
  category: string;
  order: number;
  type: SkillTypeTag;
  model: string | null;
  endpoint: string | null;
  prompt: string | null;
  inputSchema: unknown;
}

export interface SerializedSection {
  id: string;
  name: string;
  icon: string;
  order: number;
  skills: SerializedSkill[];
}
