/**
 * X (Twitter) API runtime — OAuth 2.0 PKCE + DM send.
 *
 * Flow:
 *   1. POST /oauth2/authorize  (browser redirect, returns to our callback)
 *   2. POST /oauth2/token       (exchange code for tokens)
 *   3. Store tokens at .data/x-tokens.json (gitignored)
 *   4. POST /2/dm_conversations/with/{participantId}/messages  (send DM)
 *
 * Auth header: `Authorization: Bearer {user_access_token}` (NOT the app
 * bearer — DMs are sent FROM the linked user).
 *
 * ⚠️ DM API is gated behind X Basic plan ($200/mo). Free tier 403s.
 * ⚠️ Sending DMs only works to users who follow you or have open DMs.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKENS_PATH = path.resolve(__dirname, '..', '..', '..', '.data', 'x-tokens.json');

const X_AUTHORIZE_URL = 'https://twitter.com/i/oauth2/authorize';
const X_TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
const X_API_BASE = 'https://api.twitter.com/2';
const SCOPES = ['tweet.read', 'users.read', 'dm.write', 'offline.access'];

/**
 * Wrap fetch with a hard timeout. Without this, a stuck X API call hangs the
 * entire pipeline indefinitely (observed: 5+ minutes on a single DM send).
 * 20s is generous for X API which is normally <2s; anything slower is broken
 * and we'd rather report failure than freeze the user.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 20_000, ...rest } = init;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: ctrl.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new Error(`X API timeout after ${timeoutMs / 1000}s: ${url}`);
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function clientId(): string {
  const v = process.env.X_OAUTH_CLIENT_ID;
  if (!v) throw new Error('X_OAUTH_CLIENT_ID manquante dans .env');
  return v;
}
function clientSecret(): string {
  const v = process.env.X_OAUTH_CLIENT_SECRET;
  if (!v) throw new Error('X_OAUTH_CLIENT_SECRET manquante dans .env');
  return v;
}
function redirectUri(): string {
  return process.env.X_OAUTH_REDIRECT_URI || 'http://localhost:3000/api/auth/x/callback';
}

// ---------- Token store (single-user, persisted to disk) ----------

export interface XStoredTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // ms epoch
  userId: string;
  username: string;
  scopes: string[];
  linkedAt: number;
}

let cachedTokens: XStoredTokens | null = null;
let tokensLoaded = false;

async function loadTokens(): Promise<XStoredTokens | null> {
  if (tokensLoaded) return cachedTokens;
  tokensLoaded = true;
  try {
    const raw = await fs.readFile(TOKENS_PATH, 'utf8');
    cachedTokens = JSON.parse(raw) as XStoredTokens;
    return cachedTokens;
  } catch {
    cachedTokens = null;
    return null;
  }
}

async function saveTokens(t: XStoredTokens): Promise<void> {
  cachedTokens = t;
  tokensLoaded = true;
  await fs.mkdir(path.dirname(TOKENS_PATH), { recursive: true });
  await fs.writeFile(TOKENS_PATH, JSON.stringify(t, null, 2), 'utf8');
}

async function clearTokens(): Promise<void> {
  cachedTokens = null;
  tokensLoaded = true;
  try {
    await fs.unlink(TOKENS_PATH);
  } catch {
    /* not there */
  }
}

// ---------- PKCE helpers ----------

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function generateCodeVerifier(): string {
  return base64url(crypto.randomBytes(32)); // 43 chars
}
function challengeFromVerifier(v: string): string {
  return base64url(crypto.createHash('sha256').update(v).digest());
}

// ---------- In-memory PKCE flow state (state → verifier) ----------
// Single-process server, no need for persistence (cleared on restart).
interface PendingFlow {
  codeVerifier: string;
  createdAt: number;
}
const pending = new Map<string, PendingFlow>();
const PENDING_TTL_MS = 10 * 60 * 1000;

function reapStale() {
  const now = Date.now();
  for (const [state, flow] of pending) {
    if (now - flow.createdAt > PENDING_TTL_MS) pending.delete(state);
  }
}

// ---------- OAuth surface (public API) ----------

export interface AuthUrlResult {
  url: string;
  state: string;
}

/** Step 1: build the URL we redirect the user to. */
export function buildAuthorizeUrl(): AuthUrlResult {
  reapStale();
  const state = base64url(crypto.randomBytes(16));
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = challengeFromVerifier(codeVerifier);
  pending.set(state, { codeVerifier, createdAt: Date.now() });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId(),
    redirect_uri: redirectUri(),
    scope: SCOPES.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return { url: `${X_AUTHORIZE_URL}?${params.toString()}`, state };
}

interface XTokenResponse {
  token_type?: string;
  expires_in?: number;
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface XMeResponse {
  data?: { id: string; name?: string; username: string };
  errors?: Array<{ message: string }>;
}

/** Step 2: exchange the auth code for tokens, fetch the user's identity, store. */
export async function handleCallback(params: {
  code: string;
  state: string;
}): Promise<XStoredTokens> {
  const flow = pending.get(params.state);
  if (!flow) {
    throw new Error('OAuth state inconnu ou expiré — relance le flow.');
  }
  pending.delete(params.state);

  // X requires Basic auth header AND the code_verifier in the body for
  // confidential clients with PKCE.
  const basic = Buffer.from(`${clientId()}:${clientSecret()}`).toString('base64');
  const body = new URLSearchParams({
    code: params.code,
    grant_type: 'authorization_code',
    client_id: clientId(),
    redirect_uri: redirectUri(),
    code_verifier: flow.codeVerifier,
  });

  const tokRes = await fetch(X_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const tokJson = (await tokRes.json()) as XTokenResponse;
  if (!tokRes.ok || !tokJson.access_token) {
    throw new Error(
      `X token exchange failed (${tokRes.status}): ${tokJson.error ?? ''} ${tokJson.error_description ?? ''}`.trim(),
    );
  }

  // Identify the user we just linked.
  const meRes = await fetch(`${X_API_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${tokJson.access_token}` },
  });
  const meJson = (await meRes.json()) as XMeResponse;
  if (!meRes.ok || !meJson.data?.id) {
    throw new Error(
      `X /users/me failed (${meRes.status}): ${meJson.errors?.[0]?.message ?? 'unknown'}`,
    );
  }

  const stored: XStoredTokens = {
    accessToken: tokJson.access_token,
    refreshToken: tokJson.refresh_token,
    expiresAt: Date.now() + (tokJson.expires_in ?? 7200) * 1000,
    userId: meJson.data.id,
    username: meJson.data.username,
    scopes: (tokJson.scope ?? '').split(/\s+/).filter(Boolean),
    linkedAt: Date.now(),
  };
  await saveTokens(stored);
  return stored;
}

export interface XStatus {
  linked: boolean;
  username?: string;
  userId?: string;
  expiresAt?: number;
  scopes?: string[];
}

export async function getStatus(): Promise<XStatus> {
  const t = await loadTokens();
  if (!t) return { linked: false };
  return {
    linked: true,
    username: t.username,
    userId: t.userId,
    expiresAt: t.expiresAt,
    scopes: t.scopes,
  };
}

export async function unlink(): Promise<void> {
  await clearTokens();
}

// ---------- Token refresh ----------

async function refreshIfNeeded(t: XStoredTokens): Promise<XStoredTokens> {
  // Refresh 60s before expiry
  if (t.expiresAt - Date.now() > 60_000) return t;
  if (!t.refreshToken) throw new Error('Token X expiré et pas de refresh_token — relink');

  const basic = Buffer.from(`${clientId()}:${clientSecret()}`).toString('base64');
  const body = new URLSearchParams({
    refresh_token: t.refreshToken,
    grant_type: 'refresh_token',
    client_id: clientId(),
  });
  const res = await fetch(X_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const j = (await res.json()) as XTokenResponse;
  if (!res.ok || !j.access_token) {
    throw new Error(
      `X token refresh failed (${res.status}): ${j.error ?? ''} ${j.error_description ?? ''}`.trim(),
    );
  }
  const updated: XStoredTokens = {
    ...t,
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? t.refreshToken,
    expiresAt: Date.now() + (j.expires_in ?? 7200) * 1000,
  };
  await saveTokens(updated);
  return updated;
}

async function getValidAccessToken(): Promise<string> {
  const t = await loadTokens();
  if (!t) throw new Error("Aucun compte X linké — fais Link X account d'abord");
  const fresh = await refreshIfNeeded(t);
  return fresh.accessToken;
}

// ---------- DM API ----------

export interface XUserLookup {
  id: string;
  username: string;
  name?: string;
}

interface XUserByUsernameResponse {
  data?: { id: string; name?: string; username: string };
  errors?: Array<{ message: string; detail?: string }>;
}

/** Lookup a user by @handle. */
export async function lookupUserByUsername(handle: string): Promise<XUserLookup> {
  const clean = handle.replace(/^@/, '').trim();
  if (!clean) throw new Error('handle vide');
  const token = await getValidAccessToken();
  const res = await fetchWithTimeout(
    `${X_API_BASE}/users/by/username/${encodeURIComponent(clean)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: 15_000,
    },
  );
  const j = (await res.json()) as XUserByUsernameResponse;
  if (!res.ok || !j.data?.id) {
    throw new Error(
      `X user lookup @${clean} failed (${res.status}): ${j.errors?.[0]?.message ?? 'unknown'}`,
    );
  }
  return { id: j.data.id, username: j.data.username, name: j.data.name };
}

/**
 * Batched user lookup by handles (up to 100 per call).
 * Endpoint: GET /2/users/by?usernames=h1,h2,...
 *
 * Returns user details including bio (description) and follower count.
 * Pricing: $0.010 per resource (per user returned).
 */
export interface XUserDetails {
  id: string;
  username: string;
  name?: string;
  bio?: string;
  followersCount?: number;
  verified?: boolean;
}

interface XUsersByResponse {
  data?: Array<{
    id: string;
    username: string;
    name?: string;
    description?: string;
    verified?: boolean;
    public_metrics?: {
      followers_count?: number;
      following_count?: number;
      tweet_count?: number;
    };
  }>;
  errors?: Array<{ message: string; resource_id?: string }>;
}

export async function lookupUsersByUsernames(handles: string[]): Promise<XUserDetails[]> {
  const clean = Array.from(
    new Set(handles.map((h) => h.replace(/^@/, '').trim()).filter((h) => h.length > 0)),
  ).slice(0, 100);
  if (clean.length === 0) return [];

  const token = await getValidAccessToken();
  const params = new URLSearchParams({
    usernames: clean.join(','),
    'user.fields': 'description,public_metrics,verified',
  });
  const res = await fetch(`${X_API_BASE}/users/by?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = (await res.json()) as XUsersByResponse;
  if (!res.ok) {
    throw new Error(
      `X users/by failed (${res.status}): ${j.errors?.[0]?.message ?? 'unknown'}`,
    );
  }
  return (j.data ?? []).map((u) => ({
    id: u.id,
    username: u.username,
    name: u.name,
    bio: u.description,
    followersCount: u.public_metrics?.followers_count,
    verified: u.verified,
  }));
}

interface XDmResponse {
  data?: { dm_conversation_id: string; dm_event_id: string };
  errors?: Array<{
    message?: string;
    detail?: string;
    code?: number;
    title?: string;
    type?: string;
  }>;
  title?: string;
  detail?: string;
  type?: string;
  status?: number;
}

// ---------- Recent tweet search ----------

interface XSearchTweet {
  id: string;
  text: string;
  author_id?: string;
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
  };
}
interface XSearchUser {
  id: string;
  username: string;
  name?: string;
  description?: string;
  verified?: boolean;
  public_metrics?: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
    listed_count: number;
  };
}
interface XSearchResponse {
  data?: XSearchTweet[];
  includes?: { users?: XSearchUser[] };
  meta?: { result_count?: number; next_token?: string };
  errors?: Array<{ message: string; detail?: string }>;
  title?: string;
}

export interface XSearchAuthor {
  userId: string;
  handle: string;
  name?: string;
  bio?: string;
  verified?: boolean;
  followersCount?: number;
  recentTweet?: string;
}

export interface SearchTweetsResult {
  authors: XSearchAuthor[];
  tweetsReturned: number;
}

/**
 * Run a single tweet search and dedupe authors. Returns the unique author list
 * with their bio (description) so the caller can post-filter on bio keywords.
 *
 * Query syntax: standard X recent-search operators (parens, OR, -is:retweet,
 * has:profile_image, lang:xx, etc.). Capped at 100 results per call.
 *
 * Pricing: standard "Tweet Read" tier — $0.010 per resource returned.
 */
export async function searchRecentTweets(
  query: string,
  options: { maxResults?: number; lang?: string } = {},
): Promise<SearchTweetsResult> {
  const token = await getValidAccessToken();
  const params = new URLSearchParams({
    query: options.lang ? `${query} lang:${options.lang}` : query,
    max_results: String(Math.min(Math.max(options.maxResults ?? 100, 10), 100)),
    'tweet.fields': 'public_metrics,created_at',
    'user.fields': 'description,public_metrics,verified',
    expansions: 'author_id',
  });
  const url = `${X_API_BASE}/tweets/search/recent?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = (await res.json()) as XSearchResponse;
  if (!res.ok) {
    const msg = j.errors?.[0]?.message ?? j.title ?? `HTTP ${res.status}`;
    throw new Error(`X tweet search failed (${res.status}): ${msg}`);
  }

  const tweets = j.data ?? [];
  const users = j.includes?.users ?? [];
  const usersById = new Map<string, XSearchUser>();
  for (const u of users) usersById.set(u.id, u);

  const seen = new Set<string>();
  const authors: XSearchAuthor[] = [];
  for (const t of tweets) {
    if (!t.author_id || seen.has(t.author_id)) continue;
    seen.add(t.author_id);
    const u = usersById.get(t.author_id);
    if (!u) continue;
    authors.push({
      userId: u.id,
      handle: u.username,
      name: u.name,
      bio: u.description,
      verified: u.verified,
      followersCount: u.public_metrics?.followers_count,
      recentTweet: t.text,
    });
  }

  return { authors, tweetsReturned: tweets.length };
}

/** Send a DM to a specific user. Auth header uses the LINKED USER's token. */
export async function sendDm(participantId: string, text: string): Promise<{
  dmEventId: string;
  dmConversationId: string;
}> {
  const token = await getValidAccessToken();
  const url = `${X_API_BASE}/dm_conversations/with/${encodeURIComponent(participantId)}/messages`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
    timeoutMs: 25_000,
  });
  // Read body as text first so we can log it on any error even if it's not JSON.
  const rawBody = await res.text();
  let j: XDmResponse = {};
  try {
    j = rawBody ? (JSON.parse(rawBody) as XDmResponse) : {};
  } catch {
    // X sometimes returns non-JSON HTML for auth errors. Fall through.
  }
  if (!res.ok || !j.data?.dm_event_id) {
    const err = j.errors?.[0];
    const parts = [
      `HTTP ${res.status}`,
      err?.code ? `code ${err.code}` : null,
      err?.title ?? j.title ?? null,
      err?.message ?? err?.detail ?? j.detail ?? null,
    ].filter(Boolean);
    // Log raw body for debugging. X's docs are vague on exact error formats.
    // eslint-disable-next-line no-console
    console.error(`[x-api] sendDm to ${participantId} → ${res.status} body=${rawBody.slice(0, 500)}`);
    throw new Error(`X DM send failed (${parts.join(' · ')})`);
  }
  return { dmEventId: j.data.dm_event_id, dmConversationId: j.data.dm_conversation_id };
}

/** Returns the OAuth-linked user's X user ID (from stored tokens), or null. */
export async function getLinkedUserId(): Promise<string | null> {
  const t = await loadTokens();
  return t?.userId ?? null;
}

/**
 * Lookup if a 1-1 DM conversation has any events with a participant. We use
 * this to VERIFY a DM that returned 403 — X sometimes returns 403 even after
 * the message landed (anti-abuse / duplicate detection). If the conversation
 * has events, the DM is there.
 *
 * Returns:
 *   - { exists: true, eventCount }  → conversation has messages
 *   - { exists: false }              → no conversation or empty
 *   - throws on auth error
 */
export async function dmConversationHasEvents(
  participantId: string,
): Promise<{ exists: boolean; eventCount?: number }> {
  const token = await getValidAccessToken();
  const url = `${X_API_BASE}/dm_conversations/with/${encodeURIComponent(participantId)}/dm_events?max_results=1`;
  const res = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 10_000,
  });
  if (!res.ok) {
    // 404 = no conversation. Anything else = treat as unknown, return false to
    // avoid false positives.
    return { exists: false };
  }
  const j = (await res.json()) as {
    data?: Array<{ id: string }>;
    meta?: { result_count?: number };
  };
  const count = j.meta?.result_count ?? j.data?.length ?? 0;
  return { exists: count > 0, eventCount: count };
}
