import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Section, Skill, SectionMeta, SkillMeta } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_ROOT = path.resolve(__dirname, '..', 'skills');

/**
 * Scan ./skills/<section>/<NN-skill>/ and return a structured registry.
 *
 * Layout:
 *   skills/
 *     <section-id>/
 *       section.json        → SectionMeta
 *       <NN-skill-id>/
 *         meta.json         → SkillMeta
 *         prompt.md         → (optional) prompt template for LLM skills
 */
export async function loadRegistry(): Promise<Section[]> {
  const sections: Section[] = [];
  const entries = await fs.readdir(SKILLS_ROOT, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sectionDir = path.join(SKILLS_ROOT, entry.name);
    const sectionMetaPath = path.join(sectionDir, 'section.json');

    let sectionMeta: SectionMeta;
    try {
      sectionMeta = JSON.parse(await fs.readFile(sectionMetaPath, 'utf8'));
    } catch {
      continue;
    }

    const skills: Skill[] = [];
    const skillEntries = await fs.readdir(sectionDir, { withFileTypes: true });
    for (const s of skillEntries) {
      if (!s.isDirectory()) continue;
      const skillDir = path.join(sectionDir, s.name);
      const metaPath = path.join(skillDir, 'meta.json');
      const promptPath = path.join(skillDir, 'prompt.md');

      let meta: SkillMeta;
      try {
        meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
      } catch {
        continue;
      }

      let prompt: string | null = null;
      try {
        prompt = await fs.readFile(promptPath, 'utf8');
      } catch {
        /* no prompt — api skill */
      }

      skills.push({ ...meta, folder: s.name, prompt });
    }

    skills.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    sections.push({ ...sectionMeta, skills });
  }

  sections.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  return sections;
}

/** Substitute {{var}} tokens in a prompt template. Objects are JSON-stringified. */
export function renderPrompt(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    const v = vars[k];
    if (v === undefined || v === null) return '';
    return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  });
}
