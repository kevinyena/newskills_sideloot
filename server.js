import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import { loadRegistry, renderPrompt } from './skills/loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

if (!API_KEY) {
  console.error('GEMINI_API_KEY manquante dans .env');
  process.exit(1);
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const BUSINESS_TYPES = ['agence', 'SaaS', 'newsletter', 'infoproduct', 'app mobile', 'marketplace', 'coaching', 'communauté payante'];
const LANG_NAMES = {
  fr: 'français', en: 'anglais', es: 'espagnol', de: 'allemand', it: 'italien', pt: 'portugais',
};

let REGISTRY = await loadRegistry();

// ---------- Gemini helper ----------
async function callGeminiJson({ model = 'gemini-2.5-flash', prompt, temperature = 1.0 }) {
  const url = `${GEMINI_BASE}/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  return JSON.parse(text);
}

function findSkill(sectionId, skillId) {
  const section = REGISTRY.find((s) => s.id === sectionId);
  if (!section) return null;
  const skill = section.skills.find((sk) => sk.id === skillId);
  return skill ? { section, skill } : null;
}

// ---------- Registry endpoint ----------
app.get('/api/skills', (_req, res) => res.json(REGISTRY));

app.post('/api/reload-skills', async (_req, res) => {
  REGISTRY = await loadRegistry();
  res.json({ ok: true });
});

// ---------- Skill runners ----------
// Skill: ai-ugc / create-business-idea
app.post('/api/skills/ai-ugc/create-business-idea/run', async (req, res) => {
  try {
    const { language = 'fr', businessType } = req.body || {};
    const found = findSkill('ai-ugc', 'create-business-idea');
    if (!found) return res.status(404).json({ error: 'skill introuvable' });

    const type = businessType || BUSINESS_TYPES[Math.floor(Math.random() * BUSINESS_TYPES.length)];
    const prompt = renderPrompt(found.skill.prompt, {
      businessType: type,
      languageName: LANG_NAMES[language] || 'français',
    });
    const business = await callGeminiJson({ model: found.skill.model, prompt, temperature: 1.1 });
    res.json({ business: { ...business, type }, _prompt: prompt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Skill: ai-ugc / generate-video-script
app.post('/api/skills/ai-ugc/generate-video-script/run', async (req, res) => {
  try {
    const { business, language = 'fr' } = req.body || {};
    if (!business) return res.status(400).json({ error: 'business manquant' });
    const found = findSkill('ai-ugc', 'generate-video-script');
    if (!found) return res.status(404).json({ error: 'skill introuvable' });

    const prompt = renderPrompt(found.skill.prompt, {
      businessJson: business,
      languageName: LANG_NAMES[language] || 'français',
    });
    const video = await callGeminiJson({ model: found.skill.model, prompt, temperature: 1.15 });
    res.json({ video, _prompt: prompt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Skill: ai-ugc / adapt-to-veo-prompt
app.post('/api/skills/ai-ugc/adapt-to-veo-prompt/run', async (req, res) => {
  try {
    const { business, video, language = 'fr' } = req.body || {};
    if (!business || !video) return res.status(400).json({ error: 'business ou video manquant' });
    const found = findSkill('ai-ugc', 'adapt-to-veo-prompt');
    if (!found) return res.status(404).json({ error: 'skill introuvable' });

    const prompt = renderPrompt(found.skill.prompt, {
      businessJson: business,
      videoJson: video,
      languageName: LANG_NAMES[language] || 'français',
    });
    const out = await callGeminiJson({ model: found.skill.model, prompt, temperature: 0.6 });
    res.json({ veoPrompt: out.veoPrompt, _prompt: prompt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Skill: ai-ugc / generate-video (API skill — Veo 3.1)
app.post('/api/skills/ai-ugc/generate-video/run', async (req, res) => {
  try {
    const { veoPrompt, aspectRatio = '9:16' } = req.body || {};
    if (!veoPrompt) return res.status(400).json({ error: 'veoPrompt manquant' });
    const url = `${GEMINI_BASE}/models/veo-3.1-generate-preview:predictLongRunning`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
      body: JSON.stringify({
        instances: [{ prompt: veoPrompt }],
        parameters: { aspectRatio, resolution: '720p', durationSeconds: 8 },
      }),
    });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    const data = await r.json();
    res.json({ operationName: data.name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Veo polling & proxy (utilities, not skills) ----------
app.get('/api/video-status', async (req, res) => {
  try {
    const { name } = req.query;
    if (!name) return res.status(400).json({ error: 'name manquant' });
    const r = await fetch(`${GEMINI_BASE}/${name}`, { headers: { 'x-goog-api-key': API_KEY } });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    const data = await r.json();
    const videoUri =
      data?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
      data?.response?.generatedVideos?.[0]?.video?.uri ||
      null;
    res.json({ done: !!data.done, videoUri, raw: data.error ? data : undefined });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/video-proxy', async (req, res) => {
  try {
    const { uri } = req.query;
    if (!uri) return res.status(400).json({ error: 'uri manquant' });
    const r = await fetch(uri, { headers: { 'x-goog-api-key': API_KEY } });
    if (!r.ok) return res.status(r.status).send(await r.text());
    res.setHeader('Content-Type', r.headers.get('content-type') || 'video/mp4');
    const buf = Buffer.from(await r.arrayBuffer());
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`AI Skills Hub on http://localhost:${PORT}`));
