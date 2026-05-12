import dotenv from 'dotenv';
// Override: shell env may shadow .env (e.g. an empty ANTHROPIC_API_KEY injected
// by a Claude Code session).
dotenv.config({ override: true });

import express, { type Request, type Response } from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ALL_SKILLS, buildSections, findSkill } from './skills/index.js';
import { startGeneration, pollStatus, proxyDownload, type AspectRatio } from './skills/runtime/veo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY manquante dans .env (skills LLM)');
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY manquante dans .env (génération vidéo Veo 3.1)');
  process.exit(1);
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'public')));

// ---------- Registry endpoint ----------
app.get('/api/skills', (_req: Request, res: Response) => {
  res.json(buildSections());
});

// ---------- Generic skill runner ----------
// Validates input via the skill's Zod schema, then calls execute().
// Works for any registered skill — adding a skill never requires touching server.ts.
app.post('/api/skills/:name/run', async (req: Request, res: Response) => {
  const name = String(req.params.name ?? '');
  const skill = findSkill(name);
  if (!skill) return res.status(404).json({ error: `skill '${name}' inconnue` });
  try {
    const parsed = skill.schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'inputs invalides', issues: parsed.error.issues });
    }
    const output = await skill.execute(parsed.data);
    res.json({ output });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---------- Veo split endpoints (UI progress) ----------
// The Veo skill's blocking execute() is for agents. The interactive UI uses
// these primitives directly so it can show a live progress indicator.
app.post('/api/veo/start', async (req: Request, res: Response) => {
  try {
    const { prompt, aspectRatio = '9:16' } = (req.body ?? {}) as {
      prompt?: string;
      aspectRatio?: AspectRatio;
    };
    if (!prompt) return res.status(400).json({ error: 'prompt manquant' });
    const out = await startGeneration({ prompt, aspectRatio });
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/api/veo/status', async (req: Request, res: Response) => {
  try {
    const name = req.query.name as string | undefined;
    if (!name) return res.status(400).json({ error: 'name manquant' });
    res.json(await pollStatus(name));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/api/veo/proxy', async (req: Request, res: Response) => {
  try {
    const uri = req.query.uri as string | undefined;
    if (!uri) return res.status(400).json({ error: 'uri manquant' });
    const { buffer, contentType } = await proxyDownload(uri);
    res.setHeader('Content-Type', contentType);
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.listen(PORT, () => {
  console.log(
    `AI Skills Hub on http://localhost:${PORT} — ${ALL_SKILLS.length} skills registered`,
  );
});
