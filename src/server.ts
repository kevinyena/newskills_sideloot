import dotenv from 'dotenv';
// Override: shell env may shadow .env (e.g. an empty ANTHROPIC_API_KEY injected
// by a Claude Code session).
dotenv.config({ override: true });

import express, { type Request, type Response } from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ALL_SKILLS, buildSections, findSkill } from './skills/index.js';
import { startGeneration, pollStatus, proxyDownload, type AspectRatio } from './skills/runtime/veo.js';
import {
  buildAuthorizeUrl,
  handleCallback,
  getStatus as getXStatus,
  unlink as xUnlink,
} from './skills/runtime/x-api.js';
import { runSendDMs, SendXDMsInputSchema } from './skills/x_dm/SendXDMsSkill.js';
import {
  buildAuthorizeUrl as buildTikTokAuthUrl,
  handleCallback as handleTikTokCallback,
  getStatus as getTikTokStatus,
  unlink as tikTokUnlink,
  fetchPublishStatus as fetchTikTokPublishStatus,
  postVideo as postTikTokVideo,
  type PostMode as TikTokPostMode,
} from './skills/runtime/tiktok-api.js';

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
if (!process.env.APIFY_TOKEN) {
  console.warn(
    '[warn] APIFY_TOKEN manquante dans .env — la skill fetch_maps_prospects échouera. Récupérer le token: https://console.apify.com/settings/integrations',
  );
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

// ---------- X (Twitter) OAuth ----------
app.get('/api/auth/x/login', (_req: Request, res: Response) => {
  try {
    const { url } = buildAuthorizeUrl();
    res.redirect(url);
  } catch (e) {
    res.status(500).send(`X OAuth login failed: ${(e as Error).message}`);
  }
});

app.get('/api/auth/x/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  const error = req.query.error as string | undefined;
  if (error) {
    return res.status(400).send(`<h1>X OAuth refusé</h1><p>${error}</p><a href="/">Retour</a>`);
  }
  if (!code || !state) {
    return res.status(400).send('<h1>OAuth callback invalide</h1><a href="/">Retour</a>');
  }
  try {
    const stored = await handleCallback({ code, state });
    res.send(`
      <!doctype html><meta charset="utf-8">
      <title>X linked</title>
      <style>body{font-family:system-ui;background:#0b0d12;color:#e7eaf0;padding:40px;max-width:520px;margin:auto}
        a{color:#7c5cff}.ok{color:#2bd4a0}</style>
      <h1>✓ Compte X linké</h1>
      <p>Connecté en tant que <strong>@${stored.username}</strong></p>
      <p class="ok">Scopes: ${stored.scopes.join(', ')}</p>
      <p>Tu peux fermer cet onglet et retourner sur <a href="/">l'app</a>.</p>
      <script>window.opener && window.opener.postMessage({type:'x_linked', username: '${stored.username}'}, '*'); setTimeout(()=>window.close(), 1500);</script>
    `);
  } catch (e) {
    res.status(500).send(`<h1>X OAuth failed</h1><pre>${(e as Error).message}</pre><a href="/">Retour</a>`);
  }
});

app.get('/api/auth/x/status', async (_req: Request, res: Response) => {
  try {
    res.json(await getXStatus());
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/auth/x/logout', async (_req: Request, res: Response) => {
  try {
    await xUnlink();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---------- X DM: live progress stream (SSE) ----------
// Mirrors the `send_x_dms` skill but emits per-handle events so the UI can
// show "@foo… sending → ✓ sent" live instead of waiting ~90s for the batch.
// The skill itself (run via /api/skills/send_x_dms/run) still works for agents.
app.post('/api/x-dm/send-stream', async (req: Request, res: Response) => {
  const parsed = SendXDMsInputSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'inputs invalides', issues: parsed.error.issues });
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.socket?.setNoDelay(true);
  res.socket?.setKeepAlive(true);

  // ──────────────────────────────────────────────────────────────
  // SSE flushing — true real-time delivery
  //
  // Node's `res.write(chunk)` returns immediately and queues the chunk in
  // the outgoing buffer. It doesn't guarantee the chunk has been pushed to
  // the kernel socket. The CALLBACK form `res.write(chunk, cb)` invokes cb
  // ONCE THE WRITE IS FLUSHED. We promisify that, then `await` it before
  // returning from our send helper. Combined with `setNoDelay`, each event
  // hits the wire before we proceed.
  //
  // Previous attempts (padding to 4KB, heartbeat) didn't reliably push
  // because they relied on internal heuristics. This approach explicitly
  // gates progression on flush completion — bulletproof.
  // ──────────────────────────────────────────────────────────────
  const writeAndFlush = (chunk: string): Promise<void> =>
    new Promise((resolve, reject) => {
      res.write(chunk, (err) => (err ? reject(err) : resolve()));
    });

  // Preamble: 2KB padding primes any receive-side buffering.
  await writeAndFlush(`: stream open ${' '.repeat(2048)}\n\n`);

  const send = async (event: string, data: unknown): Promise<void> => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    await writeAndFlush(payload);
    // eslint-disable-next-line no-console
    console.log(`[SSE] flushed event=${event} (${payload.length}B)`);
  };

  let closed = false;
  req.on('close', () => {
    // eslint-disable-next-line no-console
    console.log(`[SSE] req closed — was it expected? sent=${closed ? 'completed' : 'mid-stream'}`);
    closed = true;
  });

  const heartbeat = setInterval(() => {
    if (closed) return;
    writeAndFlush(`: ping ${Date.now()}\n\n`).catch(() => {});
  }, 5000);

  try {
    await runSendDMs(parsed.data, async (event) => {
      if (closed) return;
      await send(event.kind, event);
    });
  } catch (e) {
    if (!closed) {
      try { await send('error', { error: (e as Error).message }); } catch { /* ignore */ }
    }
  } finally {
    clearInterval(heartbeat);
    closed = true;
    res.end();
  }
});

// ---------- TikTok OAuth ----------
app.get('/api/auth/tiktok/login', (_req: Request, res: Response) => {
  try {
    const { url } = buildTikTokAuthUrl();
    res.redirect(url);
  } catch (e) {
    res.status(500).send(`TikTok OAuth login failed: ${(e as Error).message}`);
  }
});

app.get('/api/auth/tiktok/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  const error = req.query.error as string | undefined;
  if (error) {
    return res.status(400).send(`<h1>TikTok OAuth refusé</h1><p>${error}</p><a href="/">Retour</a>`);
  }
  if (!code || !state) {
    return res.status(400).send('<h1>OAuth callback invalide</h1><a href="/">Retour</a>');
  }
  try {
    const stored = await handleTikTokCallback({ code, state });
    res.send(`
      <!doctype html><meta charset="utf-8">
      <title>TikTok linked</title>
      <style>body{font-family:system-ui;background:#0b0d12;color:#e7eaf0;padding:40px;max-width:520px;margin:auto}
        a{color:#7c5cff}.ok{color:#2bd4a0}</style>
      <h1>✓ Compte TikTok linké</h1>
      <p>Connecté en tant que <strong>${stored.displayName ?? stored.openId}</strong></p>
      <p class="ok">Scopes: ${stored.scopes.join(', ')}</p>
      <p>Tu peux fermer cet onglet et retourner sur <a href="/">l'app</a>.</p>
      <script>window.opener && window.opener.postMessage({type:'tiktok_linked', displayName:'${stored.displayName ?? ''}'}, '*'); setTimeout(()=>window.close(), 1500);</script>
    `);
  } catch (e) {
    res.status(500).send(`<h1>TikTok OAuth failed</h1><pre>${(e as Error).message}</pre><a href="/">Retour</a>`);
  }
});

app.get('/api/auth/tiktok/status', async (_req: Request, res: Response) => {
  try {
    res.json(await getTikTokStatus());
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.post('/api/auth/tiktok/logout', async (_req: Request, res: Response) => {
  try {
    await tikTokUnlink();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---------- TikTok: upload + post a LOCAL FILE ----------
// Used when the user picks "Upload fichier" in the TikTok panel instead of
// posting a Veo-generated URI. Body is raw video bytes; metadata travels in
// headers so we don't need a multipart parser library.
app.post(
  '/api/tiktok/upload-and-post',
  // Accept any content type — we'll trust the X-Content-Type header for the
  // actual MIME (browser sends the file's real type). 64MB cap matches TikTok's
  // single-chunk upload limit.
  express.raw({ type: '*/*', limit: '64mb' }),
  async (req: Request, res: Response) => {
    try {
      const buffer = req.body as Buffer;
      if (!Buffer.isBuffer(buffer) || buffer.byteLength === 0) {
        return res.status(400).json({ error: 'Body vide — envoie les bytes vidéo dans le POST body.' });
      }
      const mode = (req.headers['x-tiktok-mode'] as TikTokPostMode | undefined) ?? 'direct';
      const privacy =
        (req.headers['x-tiktok-privacy'] as
          | 'PUBLIC_TO_EVERYONE'
          | 'MUTUAL_FOLLOW_FRIENDS'
          | 'SELF_ONLY'
          | undefined) ?? 'SELF_ONLY';
      // Caption is base64-encoded so it can carry newlines + emoji safely
      // inside an HTTP header.
      const captionB64 = req.headers['x-tiktok-caption'] as string | undefined;
      const caption = captionB64
        ? Buffer.from(captionB64, 'base64').toString('utf8')
        : undefined;

      const { publishId, finalStatus, fellBackToInbox, fallbackReason } = await postTikTokVideo({
        videoBuffer: buffer,
        caption,
        mode,
        privacyLevel: privacy,
      });

      let status: 'inbox_delivered' | 'published' | 'failed' | 'pending';
      switch (finalStatus.status) {
        case 'SEND_TO_USER_INBOX': status = 'inbox_delivered'; break;
        case 'PUBLISH_COMPLETE':    status = 'published'; break;
        case 'FAILED':              status = 'failed'; break;
        default:                    status = 'pending';
      }
      res.json({
        publishId,
        status,
        failReason: finalStatus.failReason,
        publicPostId: finalStatus.publicalyAvailablePostId,
        videoSizeBytes: buffer.byteLength,
        fellBackToInbox,
        fallbackReason,
      });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  },
);

// Allow the UI to re-poll TikTok's publish status when the inbox processing
// takes longer than the skill's internal poll timeout.
app.get('/api/tiktok/publish-status', async (req: Request, res: Response) => {
  try {
    const publishId = req.query.publishId as string | undefined;
    if (!publishId) return res.status(400).json({ error: 'publishId manquant' });
    res.json(await fetchTikTokPublishStatus(publishId));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.listen(PORT, () => {
  console.log(
    `AI Skills Hub on http://localhost:${PORT} — ${ALL_SKILLS.length} skills registered`,
  );
});
