/**
 * Veo 3.1 (Google Gemini API) runtime helpers.
 *
 * Veo generation is a long-running operation (1–3 minutes for 8s of video).
 * We expose three primitives:
 *
 *   1. `startGeneration(prompt, aspectRatio)` → returns an operationName immediately
 *   2. `pollStatus(operationName)`             → returns `{done, videoUri?}`
 *   3. `proxyDownload(uri)`                    → fetches the rendered video bytes
 *
 * For agent-blocking flows, `runBlocking(prompt, ...)` ties them together and
 * resolves once the video is ready. The host UI uses the primitives directly
 * to surface live progress.
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const VEO_MODEL = 'veo-3.1-generate-preview';
export const DEFAULT_DURATION_SECONDS = 8;
export const DEFAULT_RESOLUTION = '720p';

function apiKey(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error('GEMINI_API_KEY manquante dans .env');
  return k;
}

export type AspectRatio = '9:16' | '16:9';

export interface VeoStartParams {
  prompt: string;
  aspectRatio?: AspectRatio;
  durationSeconds?: number;
  resolution?: string;
}

export interface VeoStartResult {
  operationName: string;
}

export interface VeoStatusResult {
  done: boolean;
  videoUri: string | null;
  /** Present only when the API returned an error envelope. */
  raw?: unknown;
}

/** Kick off a Veo 3.1 generation. Returns an opaque operation name to poll. */
export async function startGeneration({
  prompt,
  aspectRatio = '9:16',
  durationSeconds = DEFAULT_DURATION_SECONDS,
  resolution = DEFAULT_RESOLUTION,
}: VeoStartParams): Promise<VeoStartResult> {
  const url = `${GEMINI_BASE}/models/${VEO_MODEL}:predictLongRunning`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey() },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { aspectRatio, resolution, durationSeconds },
    }),
  });
  if (!r.ok) throw new Error(`Veo start ${r.status}: ${await r.text()}`);
  const data = (await r.json()) as { name: string };
  return { operationName: data.name };
}

/** Poll a Veo operation. Returns `{done, videoUri?}`. */
export async function pollStatus(operationName: string): Promise<VeoStatusResult> {
  const r = await fetch(`${GEMINI_BASE}/${operationName}`, {
    headers: { 'x-goog-api-key': apiKey() },
  });
  if (!r.ok) throw new Error(`Veo poll ${r.status}: ${await r.text()}`);
  const data = (await r.json()) as {
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
  return { done: !!data.done, videoUri, raw: data.error ? data : undefined };
}

/** Fetch a generated video's bytes (the Veo URI requires the API key). */
export async function proxyDownload(
  uri: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const r = await fetch(uri, { headers: { 'x-goog-api-key': apiKey() } });
  if (!r.ok) throw new Error(`Veo download ${r.status}: ${await r.text()}`);
  return {
    buffer: Buffer.from(await r.arrayBuffer()),
    contentType: r.headers.get('content-type') ?? 'video/mp4',
  };
}

export interface RunBlockingOpts extends VeoStartParams {
  /** Total time budget. Default 5 min. */
  timeoutMs?: number;
  /** Poll interval. Default 10s. */
  pollIntervalMs?: number;
  /** Optional progress callback called on every poll. */
  onProgress?: (info: { elapsedMs: number; done: boolean }) => void;
}

/**
 * Start a Veo generation and resolve when the video is ready.
 * This is the path agent flows (Mintery, etc.) use — single call, returns videoUri.
 */
export async function runBlocking({
  timeoutMs = 5 * 60_000,
  pollIntervalMs = 10_000,
  onProgress,
  ...startParams
}: RunBlockingOpts): Promise<{ videoUri: string; operationName: string }> {
  const { operationName } = await startGeneration(startParams);
  const startedAt = Date.now();

  while (true) {
    const status = await pollStatus(operationName);
    onProgress?.({ elapsedMs: Date.now() - startedAt, done: status.done });

    if (status.done) {
      if (!status.videoUri) {
        throw new Error(
          `Veo a terminé sans retourner d'URI vidéo: ${JSON.stringify(status.raw ?? {})}`,
        );
      }
      return { videoUri: status.videoUri, operationName };
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Veo timeout après ${Math.round((Date.now() - startedAt) / 1000)}s`);
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}
