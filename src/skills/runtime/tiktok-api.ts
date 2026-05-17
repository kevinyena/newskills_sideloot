/**
 * TikTok API runtime — OAuth 2.0 PKCE + Content Posting (inbox mode).
 *
 * Flow:
 *   1. GET  /v2/auth/authorize/                    (browser redirect → callback)
 *   2. POST /v2/oauth/token/                       (exchange code for tokens)
 *   3. Store tokens at .data/tiktok-tokens.json    (gitignored)
 *   4. POST /v2/post/publish/inbox/video/init/     (request upload URL)
 *   5. PUT  {upload_url}                           (push the video bytes)
 *   6. GET  /v2/post/publish/status/fetch/         (poll until DONE)
 *
 * Inbox mode: the video lands in the user's TikTok app drafts. They open the
 * app, finalize caption/sound/cover, publish manually. No app audit needed.
 *
 * For direct-post mode, the app must pass TikTok's Content Posting API audit
 * — same upload mechanics, different init endpoint + needs `video.publish`
 * scope. We default to inbox here; the skill input has a `mode` flag for
 * when the audit is passed.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKENS_PATH = path.resolve(__dirname, '..', '..', '..', '.data', 'tiktok-tokens.json');

const TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_API_BASE = 'https://open.tiktokapis.com/v2';

/**
 * Scopes we request. `video.publish` enables direct posting (no manual finalize
 * step in the TikTok app). In sandbox/staging it works for tester accounts
 * with SELF_ONLY privacy; after audit approval it can post publicly.
 */
const SCOPES = ['user.info.basic', 'video.upload', 'video.publish'];

/**
 * Mode-aware credential resolution.
 *
 * .env has two pairs:
 *   TIKTOK_SANDBOX_OAUTH_CLIENT_ID / _SECRET   (works for tester accounts now)
 *   TIKTOK_PROD_OAUTH_CLIENT_ID    / _SECRET   (works once TikTok validates)
 *
 * `TIKTOK_MODE` (sandbox|production) selects which pair the runtime uses.
 * Falls back to the old flat names (TIKTOK_OAUTH_CLIENT_ID / TIKTOK_CLIENT_KEY)
 * if the mode-prefixed ones aren't set — keeps backward compat.
 */
function tiktokMode(): 'sandbox' | 'production' {
  const m = (process.env.TIKTOK_MODE ?? 'sandbox').toLowerCase();
  return m === 'production' || m === 'prod' ? 'production' : 'sandbox';
}
function clientKey(): string {
  const mode = tiktokMode();
  const prefix = mode === 'production' ? 'PROD' : 'SANDBOX';
  const v =
    process.env[`TIKTOK_${prefix}_OAUTH_CLIENT_ID`] ??
    process.env.TIKTOK_OAUTH_CLIENT_ID ??
    process.env.TIKTOK_CLIENT_KEY;
  if (!v) {
    throw new Error(
      `TIKTOK_${prefix}_OAUTH_CLIENT_ID manquante dans .env (TIKTOK_MODE=${mode})`,
    );
  }
  return v;
}
function clientSecret(): string {
  const mode = tiktokMode();
  const prefix = mode === 'production' ? 'PROD' : 'SANDBOX';
  const v =
    process.env[`TIKTOK_${prefix}_OAUTH_CLIENT_SECRET`] ??
    process.env.TIKTOK_OAUTH_CLIENT_SECRET ??
    process.env.TIKTOK_CLIENT_SECRET;
  if (!v) {
    throw new Error(
      `TIKTOK_${prefix}_OAUTH_CLIENT_SECRET manquante dans .env (TIKTOK_MODE=${mode})`,
    );
  }
  return v;
}
function redirectUri(): string {
  return (
    process.env.TIKTOK_OAUTH_REDIRECT_URI ??
    process.env.TIKTOK_REDIRECT_URI ??
    'http://localhost:3000/api/auth/tiktok/callback'
  );
}

// ---------- Token storage ----------

export interface TikTokStoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshExpiresAt: number;
  openId: string;
  scopes: string[];
  /** Display name pulled from user.info.basic for UI display. */
  displayName?: string;
}

let cachedTokens: TikTokStoredTokens | null = null;

async function loadTokens(): Promise<TikTokStoredTokens | null> {
  if (cachedTokens) return cachedTokens;
  try {
    const raw = await fs.readFile(TOKENS_PATH, 'utf-8');
    cachedTokens = JSON.parse(raw) as TikTokStoredTokens;
    return cachedTokens;
  } catch {
    return null;
  }
}

async function saveTokens(t: TikTokStoredTokens): Promise<void> {
  await fs.mkdir(path.dirname(TOKENS_PATH), { recursive: true });
  await fs.writeFile(TOKENS_PATH, JSON.stringify(t, null, 2), 'utf-8');
  cachedTokens = t;
}

async function clearTokens(): Promise<void> {
  cachedTokens = null;
  try { await fs.unlink(TOKENS_PATH); } catch { /* file may not exist */ }
}

// ---------- PKCE state ----------

interface PendingAuthState {
  codeVerifier: string;
  createdAt: number;
}
const pendingStates = new Map<string, PendingAuthState>();

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// ---------- Public: OAuth ----------

export function buildAuthorizeUrl(): { url: string; state: string } {
  const state = crypto.randomBytes(16).toString('hex');
  const { verifier, challenge } = generatePkce();
  pendingStates.set(state, { codeVerifier: verifier, createdAt: Date.now() });
  // Cleanup states older than 10min
  for (const [k, v] of pendingStates) {
    if (Date.now() - v.createdAt > 10 * 60 * 1000) pendingStates.delete(k);
  }

  const params = new URLSearchParams({
    client_key: clientKey(),
    scope: SCOPES.join(','),
    response_type: 'code',
    redirect_uri: redirectUri(),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return { url: `${TIKTOK_AUTH_URL}?${params.toString()}`, state };
}

interface TikTokTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  open_id?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface TikTokUserInfoResponse {
  data?: { user?: { open_id: string; display_name?: string } };
  error?: { code: string; message: string };
}

export async function handleCallback(params: {
  code: string;
  state: string;
}): Promise<TikTokStoredTokens> {
  const pending = pendingStates.get(params.state);
  if (!pending) throw new Error('state inconnu / expiré — relance le flow');
  pendingStates.delete(params.state);

  const body = new URLSearchParams({
    client_key: clientKey(),
    client_secret: clientSecret(),
    code: params.code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(),
    code_verifier: pending.codeVerifier,
  });
  const tokRes = await fetch(TIKTOK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const tokJson = (await tokRes.json()) as TikTokTokenResponse;
  if (!tokRes.ok || !tokJson.access_token || !tokJson.refresh_token) {
    throw new Error(
      `TikTok token exchange failed (${tokRes.status}): ${tokJson.error ?? ''} ${tokJson.error_description ?? ''}`.trim(),
    );
  }

  // Fetch display_name so the UI can show "Linked as @xyz".
  let displayName: string | undefined;
  try {
    const meRes = await fetch(`${TIKTOK_API_BASE}/user/info/?fields=open_id,display_name`, {
      headers: { Authorization: `Bearer ${tokJson.access_token}` },
    });
    const meJson = (await meRes.json()) as TikTokUserInfoResponse;
    displayName = meJson.data?.user?.display_name;
  } catch { /* non-fatal */ }

  const stored: TikTokStoredTokens = {
    accessToken: tokJson.access_token,
    refreshToken: tokJson.refresh_token,
    expiresAt: Date.now() + (tokJson.expires_in ?? 86400) * 1000,
    refreshExpiresAt: Date.now() + (tokJson.refresh_expires_in ?? 31_536_000) * 1000,
    openId: tokJson.open_id ?? '',
    scopes: (tokJson.scope ?? '').split(',').filter(Boolean),
    displayName,
  };
  await saveTokens(stored);
  return stored;
}

export interface TikTokStatus {
  linked: boolean;
  displayName?: string;
  openId?: string;
  scopes?: string[];
  expiresAt?: number;
}

export async function getStatus(): Promise<TikTokStatus> {
  const t = await loadTokens();
  if (!t) return { linked: false };
  return {
    linked: true,
    displayName: t.displayName,
    openId: t.openId,
    scopes: t.scopes,
    expiresAt: t.expiresAt,
  };
}

export async function unlink(): Promise<void> {
  await clearTokens();
}

// ---------- Token refresh ----------

async function refreshIfNeeded(t: TikTokStoredTokens): Promise<TikTokStoredTokens> {
  // Refresh 60s before expiry
  if (t.expiresAt - Date.now() > 60_000) return t;
  if (!t.refreshToken) throw new Error('TikTok token expiré — relink');
  const body = new URLSearchParams({
    client_key: clientKey(),
    client_secret: clientSecret(),
    grant_type: 'refresh_token',
    refresh_token: t.refreshToken,
  });
  const res = await fetch(TIKTOK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const j = (await res.json()) as TikTokTokenResponse;
  if (!res.ok || !j.access_token) {
    throw new Error(
      `TikTok refresh failed (${res.status}): ${j.error ?? ''} ${j.error_description ?? ''}`.trim(),
    );
  }
  const updated: TikTokStoredTokens = {
    ...t,
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? t.refreshToken,
    expiresAt: Date.now() + (j.expires_in ?? 86400) * 1000,
    refreshExpiresAt: j.refresh_expires_in
      ? Date.now() + j.refresh_expires_in * 1000
      : t.refreshExpiresAt,
  };
  await saveTokens(updated);
  return updated;
}

async function getValidAccessToken(): Promise<string> {
  const t = await loadTokens();
  if (!t) throw new Error('TikTok non lié — clique "Connect TikTok"');
  const fresh = await refreshIfNeeded(t);
  return fresh.accessToken;
}

// ---------- Content Posting ----------

export type PostMode = 'inbox' | 'direct';

interface InitVideoResponse {
  data?: {
    publish_id: string;
    upload_url: string;
  };
  error?: { code: string; message: string; log_id?: string };
}

/**
 * Init a video upload session. Returns the upload_url where the bytes must
 * be PUT, plus a publish_id we'll use to poll for status.
 *
 * `mode='inbox'` uses the `/inbox/video/init/` endpoint (no audit required).
 * `mode='direct'` uses `/video/init/` and requires `video.publish` scope.
 */
async function initVideoUpload(params: {
  mode: PostMode;
  videoSizeBytes: number;
  caption?: string;
  privacyLevel?: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'SELF_ONLY';
}): Promise<{ publishId: string; uploadUrl: string }> {
  const token = await getValidAccessToken();
  const endpoint = params.mode === 'inbox'
    ? `${TIKTOK_API_BASE}/post/publish/inbox/video/init/`
    : `${TIKTOK_API_BASE}/post/publish/video/init/`;

  // Single-chunk upload for simplicity. Max chunk size 64MB per TikTok docs.
  const chunkSize = params.videoSizeBytes;

  // Body shape differs slightly between inbox and direct.
  const body: Record<string, unknown> = {
    source_info: {
      source: 'FILE_UPLOAD',
      video_size: params.videoSizeBytes,
      chunk_size: chunkSize,
      total_chunk_count: 1,
    },
  };
  if (params.mode === 'direct') {
    body.post_info = {
      title: params.caption ?? '',
      privacy_level: params.privacyLevel ?? 'SELF_ONLY',
      disable_duet: false,
      disable_comment: false,
      disable_stitch: false,
      video_cover_timestamp_ms: 1000,
    };
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify(body),
  });
  const j = (await res.json()) as InitVideoResponse;
  if (!res.ok || !j.data?.upload_url || !j.data?.publish_id) {
    const err = new Error(
      `TikTok init failed (${res.status}): ${j.error?.code ?? ''} ${j.error?.message ?? 'unknown'}`.trim(),
    ) as Error & { tiktokErrorCode?: string };
    // Surface the structured TikTok error code so callers can do specific
    // recovery (e.g. fall back from direct → inbox on unaudited_client_…).
    err.tiktokErrorCode = j.error?.code;
    throw err;
  }
  return { publishId: j.data.publish_id, uploadUrl: j.data.upload_url };
}

/**
 * PUT the video bytes to TikTok's upload URL. For files under 64MB we send
 * the whole thing in one shot with the appropriate Content-Range header.
 */
async function uploadVideoBytes(
  uploadUrl: string,
  buffer: Buffer,
): Promise<void> {
  const size = buffer.byteLength;
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(size),
      // TikTok expects the byte range even for single-part uploads
      'Content-Range': `bytes 0-${size - 1}/${size}`,
    },
    // Node fetch wants a Uint8Array for binary bodies
    body: new Uint8Array(buffer),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TikTok upload PUT failed (${res.status}): ${text.slice(0, 300)}`);
  }
}

export interface TikTokPublishStatus {
  status: 'PROCESSING_UPLOAD' | 'PROCESSING_DOWNLOAD' | 'PUBLISH_COMPLETE' | 'FAILED' | 'SEND_TO_USER_INBOX' | 'UNKNOWN';
  failReason?: string;
  publicalyAvailablePostId?: string;
}

interface StatusFetchResponse {
  data?: {
    status: string;
    fail_reason?: string;
    publicaly_available_post_id?: string[];
  };
  error?: { code: string; message: string };
}

/** Poll the publish/upload status until terminal (DONE / FAILED / IN_INBOX). */
export async function fetchPublishStatus(publishId: string): Promise<TikTokPublishStatus> {
  const token = await getValidAccessToken();
  const res = await fetch(`${TIKTOK_API_BASE}/post/publish/status/fetch/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({ publish_id: publishId }),
  });
  const j = (await res.json()) as StatusFetchResponse;
  if (!res.ok || !j.data?.status) {
    throw new Error(
      `TikTok status fetch failed (${res.status}): ${j.error?.message ?? 'unknown'}`,
    );
  }
  return {
    status: j.data.status as TikTokPublishStatus['status'],
    failReason: j.data.fail_reason,
    publicalyAvailablePostId: j.data.publicaly_available_post_id?.[0],
  };
}

/**
 * Full helper: init + upload + poll status. Returns once we reach a terminal
 * state. Caller passes the raw video bytes (already downloaded from Veo).
 */
export async function postVideo(params: {
  videoBuffer: Buffer;
  caption?: string;
  mode: PostMode;
  privacyLevel?: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'SELF_ONLY';
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}): Promise<{
  publishId: string;
  finalStatus: TikTokPublishStatus;
  /** True if we fell back from direct → inbox due to TikTok sandbox restrictions. */
  fellBackToInbox?: boolean;
  /** Error code from TikTok if a fallback happened — used by the UI to explain. */
  fallbackReason?: string;
}> {
  let activeMode = params.mode;
  let fellBackToInbox = false;
  let fallbackReason: string | undefined;

  let initResult: { publishId: string; uploadUrl: string };
  try {
    initResult = await initVideoUpload({
      mode: activeMode,
      videoSizeBytes: params.videoBuffer.byteLength,
      caption: params.caption,
      privacyLevel: params.privacyLevel,
    });
  } catch (e) {
    // TikTok sandbox restriction: an unaudited app's direct-post endpoint
    // only works for PRIVATE recipient accounts. If the user's TikTok account
    // is public, this 403s with `unaudited_client_can_only_post_to_private_accounts`.
    // Fallback: silently retry as inbox mode — the video lands in the user's
    // TikTok app drafts and they can finalize from their phone.
    const err = e as Error & { tiktokErrorCode?: string };
    const isSandboxDirectBlock =
      activeMode === 'direct' &&
      (err.tiktokErrorCode === 'unaudited_client_can_only_post_to_private_accounts' ||
        err.message.includes('unaudited_client_can_only_post_to_private_accounts'));
    if (!isSandboxDirectBlock) throw e;

    // eslint-disable-next-line no-console
    console.warn(
      `[tiktok] Direct post blocked (sandbox + public account). Falling back to inbox mode automatically.`,
    );
    activeMode = 'inbox';
    fellBackToInbox = true;
    fallbackReason = err.tiktokErrorCode ?? 'unaudited_client_can_only_post_to_private_accounts';
    initResult = await initVideoUpload({
      mode: activeMode,
      videoSizeBytes: params.videoBuffer.byteLength,
      caption: params.caption,
      privacyLevel: params.privacyLevel,
    });
  }
  const { publishId, uploadUrl } = initResult;
  await uploadVideoBytes(uploadUrl, params.videoBuffer);

  // Poll until terminal. TikTok says < 1 min usually.
  const interval = params.pollIntervalMs ?? 3000;
  const deadline = Date.now() + (params.pollTimeoutMs ?? 5 * 60 * 1000);
  let last: TikTokPublishStatus = { status: 'UNKNOWN' };
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    last = await fetchPublishStatus(publishId);
    if (
      last.status === 'PUBLISH_COMPLETE' ||
      last.status === 'SEND_TO_USER_INBOX' ||
      last.status === 'FAILED'
    ) {
      return { publishId, finalStatus: last, fellBackToInbox, fallbackReason };
    }
  }
  return { publishId, finalStatus: last, fellBackToInbox, fallbackReason };
}
