/**
 * Apify Google Maps Scraper wrapper (`compass/google-maps-scraper`).
 *
 * Why this exists: Gemini Maps Grounding doesn't expose `website` as a
 * structured field — the "has website" filter we tried at prompt-level
 * was unreliable. Apify's actor:
 *   - Filters structurally on `website: "withWebsite"`
 *   - Returns native `website`, `phone`, `address`, `totalScore`, `placeId`, …
 *   - Has a built-in "Company contacts enrichment" that scrapes emails +
 *     social links from each business' website
 *
 * One synchronous actor run = one API call from our side. We use
 * `/run-sync-get-dataset-items` which returns the dataset items inline.
 *
 * Pricing (Free / Starter plan, May 2026):
 *   - Base scrape: $4 / 1,000 places                 ($0.004 per place)
 *   - "withWebsite" filter ($) : $0.001 per result   ($0.001 per place)
 *   - Company contacts enrichment ($) : ~$0.03 per place (estimate, varies by tier)
 *
 * Actor ID: nwua9Gu5YrADL7ZDj (compass/google-maps-scraper)
 */

const APIFY_BASE = 'https://api.apify.com/v2';
export const APIFY_ACTOR_ID = 'nwua9Gu5YrADL7ZDj'; // compass/google-maps-scraper

// Rough cost estimates — surfaced in the UI as "estimated" since the actual
// invoice depends on the user's Apify subscription tier and the run's actual
// scope. The actor returns its real run cost in the response which we also store.
const PRICING = {
  basePerPlace: 0.004,
  websiteFilterPerPlace: 0.001,
  contactsEnrichmentPerPlace: 0.03,
} as const;

function apifyToken(): string {
  const t = process.env.APIFY_TOKEN;
  if (!t) throw new Error('APIFY_TOKEN manquante dans .env (Apify Google Maps Scraper)');
  return t;
}

// ---------- Output types ----------

export interface ProspectSocials {
  instagram?: string[];
  facebook?: string[];
  linkedin?: string[];
  youtube?: string[];
  tiktok?: string[];
  twitter?: string[];
  pinterest?: string[];
}

export interface MapsProspect {
  name: string;
  address?: string;
  /** Phone listed on the Maps fiche (canonical). */
  phone?: string;
  /** Phone(s) scraped from the website (may differ from Maps phone). */
  phonesFromWebsite?: string[];
  /** Business website URL (filtered upstream: every prospect has one). */
  website?: string;
  /** Up to 2 contact emails scraped from the business website. */
  emails?: string[];
  socials?: ProspectSocials;
  rating?: number;
  reviewsCount?: number;
  category?: string;
  googleMapsUri?: string;
  placeId?: string;
  /** First sentence of Apify's description / category, surfaced as summary. */
  summary?: string;
}

export interface ApifyMapsStats {
  /** Raw count of places returned by Apify (all have website thanks to filter). */
  rawCount: number;
  /** How many had a confirmed website (sanity check, should equal rawCount). */
  withWebsite: number;
  /** How many had at least one email scraped from their website. */
  withEmails: number;
  /** What the caller asked for. */
  target: number;
  /** True iff withEmails >= target. */
  done: boolean;
  /** Estimated cost in USD based on rate card. */
  costUsdEstimate: number;
  /** Actual cost reported by Apify (`run.usageTotalUsd`). May be undefined if billing not surfaced yet. */
  costUsdActual?: number;
  /** Apify run ID — link to console.apify.com/actors/runs/{id}. */
  actorRunId?: string;
}

export interface FetchProspectsResult {
  prospects: MapsProspect[];
  stats: ApifyMapsStats;
}

// ---------- Apify wire types ----------

interface ApifyPlaceContacts {
  emails?: string[];
  phones?: string[];
  instagrams?: string[];
  facebooks?: string[];
  linkedIns?: string[];
  youtubes?: string[];
  tiktoks?: string[];
  twitters?: string[];
  pinterests?: string[];
}

interface ApifyPlace {
  title?: string;
  address?: string;
  street?: string;
  city?: string;
  postalCode?: string;
  state?: string;
  countryCode?: string;
  phone?: string;
  phoneUnformatted?: string;
  website?: string;
  url?: string;
  totalScore?: number;
  reviewsCount?: number;
  placeId?: string;
  categoryName?: string;
  description?: string;
  // contacts enrichment fields are merged at the top level by the actor:
  emails?: string[];
  phones?: string[];
  instagrams?: string[];
  facebooks?: string[];
  linkedIns?: string[];
  youtubes?: string[];
  tiktoks?: string[];
  twitters?: string[];
  pinterests?: string[];
  // also possibly nested under `companyContacts`
  companyContacts?: ApifyPlaceContacts;
}

// ---------- Public API ----------

export interface FetchProspectsParams {
  /** Search term — feeds Apify's `searchStringsArray`. */
  mapsQuery: string;
  /** Free-text location — feeds Apify's `locationQuery`. */
  city: string;
  /** How many prospects WITH EMAIL we ultimately want. */
  target: number;
  /** Language code for the Maps language (default: 'fr'). */
  language?: string;
}

/**
 * Run the Apify Google Maps Scraper synchronously, with the upstream
 * has-website filter + Company contacts enrichment enabled.
 *
 * Over-fetches by ~3x of `target` because not every website will yield an
 * email after scraping. We then trim to `target` once we have enough.
 */
export async function fetchProspectsFromApify(
  params: FetchProspectsParams,
): Promise<FetchProspectsResult> {
  const target = params.target;
  // Over-fetch to absorb places whose website has no scrapable email.
  // Empirically ~30% of places yield an email via Apify's contacts enrichment,
  // so we ask for ~5x the target. Capped at 80 to keep the actor run under 5 min.
  const maxPlaces = Math.min(80, Math.max(target * 5, 30));

  const input = {
    searchStringsArray: [params.mapsQuery],
    locationQuery: params.city,
    maxCrawledPlacesPerSearch: maxPlaces,
    language: params.language ?? 'fr',
    // Structural filter — only places with a website ($)
    website: 'withWebsite' as const,
    skipClosedPlaces: true,
    // Company contacts enrichment ($) — scrapes emails, phones, socials
    // from the place's website. This is the magic that makes this skill work.
    scrapeContacts: true,
    // No need for these:
    maxReviews: 0,
    maxImages: 0,
    maxQuestions: 0,
  };

  // Async pattern — way more robust than run-sync for >30s actor runs.
  // The sync endpoint holds an HTTP connection open for the whole run, which
  // Node's undici fetch can drop on `headersTimeout` (defaults vary by Node
  // version). Async = 3 short HTTP calls instead of one 1-3min open connection.
  //
  // 1. Start the run                  POST /acts/{id}/runs
  // 2. Poll until SUCCEEDED|FAILED    GET  /actor-runs/{runId}
  // 3. Fetch dataset items            GET  /datasets/{datasetId}/items
  const { runId, datasetId, actualCostUsd: costUsdActual } = await startAndPollRun(input);

  const itemsRes = await fetch(
    `${APIFY_BASE}/datasets/${datasetId}/items?token=${encodeURIComponent(apifyToken())}&clean=true&format=json`,
  );
  if (!itemsRes.ok) {
    throw new Error(`Apify dataset fetch ${itemsRes.status}: ${await itemsRes.text()}`);
  }
  const items = (await itemsRes.json()) as ApifyPlace[];
  if (!Array.isArray(items)) {
    throw new Error('Apify dataset items response was not an array');
  }
  const actorRunId = runId;
  const rawCount = items.length;

  // Map → our MapsProspect shape.
  const all: MapsProspect[] = items
    .filter((it) => typeof it.title === 'string' && (it.website?.length ?? 0) > 0)
    .map((it) => {
      // Apify may nest contacts under `companyContacts` OR merge at top level.
      const c = it.companyContacts ?? {};
      const emails = (it.emails ?? c.emails ?? []).slice(0, 2);
      const phonesFromWebsite = (it.phones ?? c.phones ?? []).filter((p) => p && p !== it.phone);
      const socials: ProspectSocials = {
        instagram: it.instagrams ?? c.instagrams,
        facebook: it.facebooks ?? c.facebooks,
        linkedin: it.linkedIns ?? c.linkedIns,
        youtube: it.youtubes ?? c.youtubes,
        tiktok: it.tiktoks ?? c.tiktoks,
        twitter: it.twitters ?? c.twitters,
        pinterest: it.pinterests ?? c.pinterests,
      };
      // Strip empty social arrays for tidy UI rendering
      const cleanSocials: ProspectSocials = {};
      for (const [k, v] of Object.entries(socials)) {
        if (Array.isArray(v) && v.length > 0) (cleanSocials as Record<string, unknown>)[k] = v;
      }

      return {
        name: it.title!,
        address: it.address,
        phone: it.phone,
        phonesFromWebsite: phonesFromWebsite.length ? phonesFromWebsite : undefined,
        website: it.website,
        emails: emails.length ? emails : undefined,
        socials: Object.keys(cleanSocials).length ? cleanSocials : undefined,
        rating: it.totalScore,
        reviewsCount: it.reviewsCount,
        category: it.categoryName,
        googleMapsUri: it.url,
        placeId: it.placeId,
        summary: firstSentence(it.description) ?? it.categoryName,
      };
    });

  const withWebsite = all.length;

  // Trim to target — keep entries WITH emails first, then top up with the rest
  // if we couldn't reach `target` with email-having entries alone.
  const withEmailsList = all.filter((p) => p.emails && p.emails.length > 0);
  const withoutEmailsList = all.filter((p) => !p.emails || p.emails.length === 0);
  const finalList = withEmailsList.slice(0, target);
  // If we still have headroom and there were no-email prospects, return them too —
  // they at least have website + phone for downstream enrichment.
  while (finalList.length < target && withoutEmailsList.length > 0) {
    finalList.push(withoutEmailsList.shift()!);
  }

  // Estimate cost — see PRICING comment up top.
  const costUsdEstimate = Number(
    (
      rawCount * PRICING.basePerPlace +
      rawCount * PRICING.websiteFilterPerPlace +
      rawCount * PRICING.contactsEnrichmentPerPlace
    ).toFixed(4),
  );

  const stats: ApifyMapsStats = {
    rawCount,
    withWebsite,
    withEmails: withEmailsList.length,
    target,
    done: withEmailsList.length >= target,
    costUsdEstimate,
    costUsdActual,
    actorRunId,
  };

  return { prospects: finalList, stats };
}

function firstSentence(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const trimmed = s.trim();
  const end = trimmed.search(/[.!?]/);
  if (end === -1 || end > 160) return trimmed.slice(0, 160);
  return trimmed.slice(0, end + 1);
}

// ---------- Async runner (start + poll + dataset) ----------

interface ApifyRunData {
  id: string;
  status: 'READY' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'ABORTED' | 'TIMED-OUT';
  defaultDatasetId: string;
  usageTotalUsd?: number;
  statusMessage?: string;
  exitCode?: number;
}
interface ApifyRunResponse {
  data?: ApifyRunData;
  error?: { type: string; message: string };
}

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 min hard cap

async function startAndPollRun(input: unknown): Promise<{
  runId: string;
  datasetId: string;
  actualCostUsd?: number;
}> {
  // 1. Start the run
  const startUrl = `${APIFY_BASE}/acts/${APIFY_ACTOR_ID}/runs?token=${encodeURIComponent(apifyToken())}`;
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
    throw new Error(`Apify start run: malformed response: ${JSON.stringify(startBody).slice(0, 300)}`);
  }
  const runId = startBody.data.id;
  const datasetId = startBody.data.defaultDatasetId;

  // 2. Poll until terminal status
  const pollUrl = `${APIFY_BASE}/actor-runs/${runId}?token=${encodeURIComponent(apifyToken())}`;
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStatus: ApifyRunData['status'] = 'READY';
  let actualCostUsd: number | undefined;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const pollRes = await fetch(pollUrl);
    if (!pollRes.ok) {
      // Transient — try a couple times before giving up
      continue;
    }
    const pollBody = (await pollRes.json()) as ApifyRunResponse;
    if (!pollBody.data) continue;
    lastStatus = pollBody.data.status;
    actualCostUsd = pollBody.data.usageTotalUsd;
    if (lastStatus === 'SUCCEEDED') {
      return { runId, datasetId, actualCostUsd };
    }
    if (lastStatus === 'FAILED' || lastStatus === 'ABORTED' || lastStatus === 'TIMED-OUT') {
      throw new Error(
        `Apify run ${runId} ended with status=${lastStatus} (${pollBody.data.statusMessage ?? 'no message'})`,
      );
    }
  }
  throw new Error(`Apify run ${runId} did not finish within ${POLL_TIMEOUT_MS / 1000}s (last status: ${lastStatus})`);
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
