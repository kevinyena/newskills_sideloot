import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadRegistry, renderPrompt } from './skills-loader.js';
import type { Section, Skill, Business, VideoScript, Language, AspectRatio } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

if (!API_KEY) {
  console.error('GEMINI_API_KEY manquante dans .env');
  process.exit(1);
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'public')));

const BUSINESS_TYPES = [
  'agence', 'SaaS', 'newsletter', 'infoproduct',
  'app mobile', 'marketplace', 'coaching', 'communauté payante',
] as const;

const LANG_NAMES: Record<Language, string> = {
  fr: 'français', en: 'anglais', es: 'espagnol',
  de: 'allemand', it: 'italien', pt: 'portugais',
};

let REGISTRY: Section[] = await loadRegistry();

// ---------- Gemini helper ----------
interface GeminiCallOpts {
  model?: string;
  prompt: string;
  temperature?: number;
}

async function callGeminiJson<T>({ model = 'gemini-2.5-flash', prompt, temperature = 1.0 }: GeminiCallOpts): Promise<T> {
  const url = `${GEMINI_BASE}/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY! },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  return JSON.parse(text) as T;
}

function findSkill(sectionId: string, skillId: string): { section: Section; skill: Skill } | null {
  const section = REGISTRY.find((s) => s.id === sectionId);
  if (!section) return null;
  const skill = section.skills.find((sk) => sk.id === skillId);
  return skill ? { section, skill } : null;
}

function langName(lang: string | undefined): string {
  return LANG_NAMES[(lang as Language) ?? 'fr'] ?? 'français';
}

// ---------- Registry endpoints ----------
app.get('/api/skills', (_req: Request, res: Response) => res.json(REGISTRY));

app.post('/api/reload-skills', async (_req: Request, res: Response) => {
  REGISTRY = await loadRegistry();
  res.json({ ok: true });
});

// ---------- Skill: ai-ugc / create-business-idea ----------
interface CreateIdeaBody { language?: Language; businessType?: string; }

app.post('/api/skills/ai-ugc/create-business-idea/run', async (req: Request, res: Response) => {
  try {
    const { language = 'fr', businessType } = (req.body ?? {}) as CreateIdeaBody;
    const found = findSkill('ai-ugc', 'create-business-idea');
    if (!found?.skill.prompt) return res.status(404).json({ error: 'skill introuvable' });

    const type = businessType || BUSINESS_TYPES[Math.floor(Math.random() * BUSINESS_TYPES.length)]!;
    const prompt = renderPrompt(found.skill.prompt, {
      businessType: type,
      languageName: langName(language),
    });
    const business = await callGeminiJson<Omit<Business, 'type'> & { type?: string }>({
      model: found.skill.model,
      prompt,
      temperature: 1.1,
    });
    res.json({ business: { ...business, type }, _prompt: prompt });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---------- Skill: ai-ugc / generate-video-script ----------
interface GenScriptBody { business: Business; language?: Language; }

app.post('/api/skills/ai-ugc/generate-video-script/run', async (req: Request, res: Response) => {
  try {
    const { business, language = 'fr' } = (req.body ?? {}) as GenScriptBody;
    if (!business) return res.status(400).json({ error: 'business manquant' });
    const found = findSkill('ai-ugc', 'generate-video-script');
    if (!found?.skill.prompt) return res.status(404).json({ error: 'skill introuvable' });

    const prompt = renderPrompt(found.skill.prompt, {
      businessJson: business,
      languageName: langName(language),
    });
    const video = await callGeminiJson<VideoScript>({
      model: found.skill.model,
      prompt,
      temperature: 1.15,
    });
    res.json({ video, _prompt: prompt });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---------- Skill: ai-ugc / adapt-to-veo-prompt ----------
interface AdaptBody { business: Business; video: VideoScript; language?: Language; }

app.post('/api/skills/ai-ugc/adapt-to-veo-prompt/run', async (req: Request, res: Response) => {
  try {
    const { business, video, language = 'fr' } = (req.body ?? {}) as AdaptBody;
    if (!business || !video) return res.status(400).json({ error: 'business ou video manquant' });
    const found = findSkill('ai-ugc', 'adapt-to-veo-prompt');
    if (!found?.skill.prompt) return res.status(404).json({ error: 'skill introuvable' });

    const prompt = renderPrompt(found.skill.prompt, {
      businessJson: business,
      videoJson: video,
      languageName: langName(language),
    });
    const out = await callGeminiJson<{ veoPrompt: string }>({
      model: found.skill.model,
      prompt,
      temperature: 0.6,
    });
    res.json({ veoPrompt: out.veoPrompt, _prompt: prompt });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---------- Skill: ai-ugc / generate-video (Veo 3.1) ----------
interface GenVideoBody { veoPrompt: string; aspectRatio?: AspectRatio; }

app.post('/api/skills/ai-ugc/generate-video/run', async (req: Request, res: Response) => {
  try {
    const { veoPrompt, aspectRatio = '9:16' } = (req.body ?? {}) as GenVideoBody;
    if (!veoPrompt) return res.status(400).json({ error: 'veoPrompt manquant' });

    const url = `${GEMINI_BASE}/models/veo-3.1-generate-preview:predictLongRunning`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY! },
      body: JSON.stringify({
        instances: [{ prompt: veoPrompt }],
        parameters: { aspectRatio, resolution: '720p', durationSeconds: 8 },
      }),
    });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    const data = await r.json() as { name: string };
    res.json({ operationName: data.name });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---------- Veo polling & proxy ----------
app.get('/api/video-status', async (req: Request, res: Response) => {
  try {
    const name = req.query.name as string | undefined;
    if (!name) return res.status(400).json({ error: 'name manquant' });
    const r = await fetch(`${GEMINI_BASE}/${name}`, { headers: { 'x-goog-api-key': API_KEY! } });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });

    const data = await r.json() as {
      done?: boolean;
      response?: {
        generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> };
        generatedVideos?: Array<{ video?: { uri?: string } }>;
      };
      error?: unknown;
    };

    const videoUri =
      data?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ??
      data?.response?.generatedVideos?.[0]?.video?.uri ??
      null;

    res.json({ done: !!data.done, videoUri, raw: data.error ? data : undefined });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/api/video-proxy', async (req: Request, res: Response) => {
  try {
    const uri = req.query.uri as string | undefined;
    if (!uri) return res.status(400).json({ error: 'uri manquant' });
    const r = await fetch(uri, { headers: { 'x-goog-api-key': API_KEY! } });
    if (!r.ok) return res.status(r.status).send(await r.text());
    res.setHeader('Content-Type', r.headers.get('content-type') ?? 'video/mp4');
    const buf = Buffer.from(await r.arrayBuffer());
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.listen(PORT, () => console.log(`AI Skills Hub on http://localhost:${PORT}`));
