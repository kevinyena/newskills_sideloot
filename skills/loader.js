import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Scan ./skills/<section>/<NN-skill>/ and return a structured registry.
 *
 * Layout:
 *   skills/
 *     <section-id>/
 *       section.json        → { id, name, icon, description, order }
 *       <NN-skill-id>/
 *         meta.json         → { id, order, name, description, type, ... }
 *         prompt.md         → (optional) prompt template for LLM skills
 */
export async function loadRegistry() {
  const sections = [];
  const entries = await fs.readdir(__dirname, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sectionDir = path.join(__dirname, entry.name);
    const sectionMetaPath = path.join(sectionDir, 'section.json');
    let sectionMeta;
    try {
      sectionMeta = JSON.parse(await fs.readFile(sectionMetaPath, 'utf8'));
    } catch {
      continue;
    }

    const skills = [];
    const skillEntries = await fs.readdir(sectionDir, { withFileTypes: true });
    for (const s of skillEntries) {
      if (!s.isDirectory()) continue;
      const skillDir = path.join(sectionDir, s.name);
      const metaPath = path.join(skillDir, 'meta.json');
      const promptPath = path.join(skillDir, 'prompt.md');
      let meta;
      try {
        meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
      } catch {
        continue;
      }
      let prompt = null;
      try {
        prompt = await fs.readFile(promptPath, 'utf8');
      } catch {}
      skills.push({ ...meta, folder: s.name, prompt });
    }
    skills.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    sections.push({ ...sectionMeta, skills });
  }

  sections.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  return sections;
}

/** Substitute {{var}} tokens in a prompt template. */
export function renderPrompt(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    vars[k] === undefined ? '' : typeof vars[k] === 'string' ? vars[k] : JSON.stringify(vars[k], null, 2)
  );
}
