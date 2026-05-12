// Shared types between server and client.
// The client imports only the type-only declarations (erased at build time).

export type SkillType = 'llm' | 'api';

export interface SectionMeta {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  order?: number;
}

export interface SkillMeta {
  id: string;
  order?: number;
  name: string;
  description?: string;
  type: SkillType;
  model?: string;
  endpoint?: string;
  inputs?: string[];
  outputs?: string[];
}

export interface Skill extends SkillMeta {
  folder: string;
  prompt: string | null;
}

export interface Section extends SectionMeta {
  skills: Skill[];
}

// ---- AI UGC domain types ----

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

export type Language = 'fr' | 'en' | 'es' | 'de' | 'it' | 'pt';
export type AspectRatio = '9:16' | '16:9';
