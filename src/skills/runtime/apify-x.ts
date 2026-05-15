/**
 * Apify X (Twitter) USER search wrapper.
 *
 * Uses `apidojo/twitter-user-scraper` with the `searchTerms` input field
 * (the actor's "Keyword Search — Find users by bio, name, or description").
 *
 * Pricing (May 2026, consistent across all Apify plans):
 *   - Keyword search query     : $8 / 1,000  = $0.008 per query
 *   - Dataset items (per user) : $0.40 / 1,000 = $0.0004 per user
 *   - ⇒ One Find prospects run ≈ $0.008 + (20 users × $0.0004) ≈ $0.016
 *
 * No hard rate limits — pay-as-you-go credits from your Apify account.
 */

const APIFY_BASE = 'https://api.apify.com/v2';
// `username~slug` format — Apify API accepts this in path params.
export const X_USER_SCRAPER_ACTOR_ID = 'apidojo~twitter-user-scraper';

function apifyToken(): string {
  const t = process.env.APIFY_TOKEN;
  if (!t) throw new Error('APIFY_TOKEN manquante dans .env (Apify X user scraper)');
  return t;
}

// ---------- Apify wire types ----------

interface ApifyRunData {
  id: string;
  status: 'READY' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'ABORTED' | 'TIMED-OUT';
  defaultDatasetId: string;
  usageTotalUsd?: number;
  statusMessage?: string;
}
interface ApifyRunResponse {
  data?: ApifyRunData;
  error?: { type: string; message: string };
}

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

async function startAndPollRun(actorId: string, input: unknown): Promise<{
  runId: string;
  datasetId: string;
  actualCostUsd?: number;
  statusMessage?: string;
}> {
  const startUrl = `${APIFY_BASE}/acts/${actorId}/runs?token=${encodeURIComponent(apifyToken())}`;
  const startRes = await fetch(startUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!startRes.ok) {
    throw new Error(`Apify start run ${startRes.status}: ${await startRes.text()}`);
  }
  const startBody = (await startRes.json()) as ApifyRunResponse;
  if (!startBody.data?.id) {
    throw new Error(`Apify start run malformed: ${JSON.stringify(startBody).slice(0, 300)}`);
  }
  const runId = startBody.data.id;
  const datasetId = startBody.data.defaultDatasetId;

  const pollUrl = `${APIFY_BASE}/actor-runs/${runId}?token=${encodeURIComponent(apifyToken())}`;
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStatus: ApifyRunData['status'] = 'READY';
  let actualCostUsd: number | undefined;
  let statusMessage: string | undefined;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const pollRes = await fetch(pollUrl);
    if (!pollRes.ok) continue;
    const pollBody = (await pollRes.json()) as ApifyRunResponse;
    if (!pollBody.data) continue;
    lastStatus = pollBody.data.status;
    actualCostUsd = pollBody.data.usageTotalUsd;
    statusMessage = pollBody.data.statusMessage;
    if (lastStatus === 'SUCCEEDED') return { runId, datasetId, actualCostUsd, statusMessage };
    if (lastStatus === 'FAILED' || lastStatus === 'ABORTED' || lastStatus === 'TIMED-OUT') {
      throw new Error(
        `Apify run ${runId} ${lastStatus}: ${statusMessage ?? 'no message'}`,
      );
    }
  }
  throw new Error(`Apify run ${runId} timed out (${POLL_TIMEOUT_MS / 1000}s, last: ${lastStatus})`);
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// ---------- Public API ----------

/**
 * Raw user record as returned by apidojo/twitter-user-scraper.
 * Field names vary slightly between actor runs, so we widen the type.
 */
export interface ApifyXUser {
  id?: string;
  rest_id?: string;
  username?: string;
  screenName?: string;
  userName?: string;
  name?: string;
  displayName?: string;
  description?: string;
  bio?: string;
  followers?: number;
  followersCount?: number;
  following?: number;
  followingCount?: number;
  isVerified?: boolean;
  isBlueVerified?: boolean;
  verified?: boolean;
  profilePicture?: string;
  url?: string;
}

export interface SearchUsersResult {
  users: ApifyXUser[];
  runId: string;
  costUsdActual?: number;
  /** Status message from the Apify run — e.g. "Please subscribe to a paid plan" on Free tier. */
  statusMessage?: string;
}

export interface SearchXUsersParams {
  /** One or more keyword/phrase search terms. Actor returns users matching ANY. */
  searchTerms: string[];
  /** Max users to scrape. */
  maxItems: number;
}

/**
 * Run `apidojo/twitter-user-scraper` with `searchTerms` (the correct input
 * field for keyword search — NOT `startUrls`, which is for direct profile URLs).
 *
 * Disables follower/following/retweeter enrichment — we don't need them
 * and they add cost ($16/1000 each).
 */
export async function searchXUsersByQuery(
  params: SearchXUsersParams,
): Promise<SearchUsersResult> {
  const input = {
    searchTerms: params.searchTerms,
    maxItems: params.maxItems,
    getFollowers: false,
    getFollowing: false,
    getRetweeters: false,
    getAbout: false,
    includeUnavailableUsers: false,
  };

  const { runId, datasetId, actualCostUsd, statusMessage: pollStatusMessage } =
    await startAndPollRun(X_USER_SCRAPER_ACTOR_ID, input);

  const itemsRes = await fetch(
    `${APIFY_BASE}/datasets/${datasetId}/items?token=${encodeURIComponent(apifyToken())}&clean=true&format=json`,
  );
  if (!itemsRes.ok) {
    throw new Error(`Apify dataset fetch ${itemsRes.status}: ${await itemsRes.text()}`);
  }
  const rawItems = (await itemsRes.json()) as ApifyXUser[];
  if (!Array.isArray(rawItems)) {
    throw new Error('Apify response was not an array of users');
  }

  // ⚠️ Free Plan detection: Apify returns N stub items `{demo: true}` instead
  // of real users when this actor is run via API on the Free Plan. These have
  // no username/bio/etc — useless. Detect and surface as a clear error.
  const allDemo =
    rawItems.length > 0 &&
    rawItems.every(
      (it) =>
        it && typeof it === 'object' && (it as unknown as { demo?: boolean }).demo === true,
    );

  if (allDemo) {
    return {
      users: [],
      runId,
      costUsdActual: actualCostUsd,
      statusMessage:
        `Apify a renvoyé ${rawItems.length} items "{demo: true}" au lieu de vrais profils — ton plan Apify ne supporte pas l'API de cet actor (apidojo/twitter-user-scraper). Upgrade Apify Starter ($49/mo) sur https://apify.com/pricing pour débloquer.`,
    };
  }

  return { users: rawItems, runId, costUsdActual: actualCostUsd, statusMessage: pollStatusMessage };
}

/** Normalize an Apify-X-user to our flat shape. */
export function normalizeApifyXUser(u: ApifyXUser): {
  userId: string;
  handle: string;
  name?: string;
  bio?: string;
  followersCount?: number;
  verified?: boolean;
} | null {
  const handle = u.username ?? u.userName ?? u.screenName;
  if (!handle) return null;
  const userId = u.id ?? u.rest_id ?? '';
  const bio = u.description ?? u.bio;
  const followersCount = u.followers ?? u.followersCount;
  const verified = u.isVerified ?? u.isBlueVerified ?? u.verified;
  return {
    userId,
    handle: handle.replace(/^@/, ''),
    name: u.name ?? u.displayName,
    bio,
    followersCount,
    verified,
  };
}
