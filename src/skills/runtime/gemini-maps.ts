/**
 * Gemini API — local prospect pipeline that LOOPS until `target` prospects
 * with at least one email are found.
 *
 * One iteration =
 *   1. Maps Grounding   (`tools: [{ googleMaps: {} }]`)    → new places
 *   2. Search Grounding (`tools: [{ google_search: {} }]`) → website/phone/…
 *   3. URL Context      (`tools: [{ url_context: {} }]`)   → up to 2 emails/site
 *
 * The orchestrator accumulates results across iterations, asking Maps to
 * EXCLUDE already-seen names each round. It stops when:
 *   • we hit the email target, OR
 *   • Maps returns no new places, OR
 *   • we hit a safety cap (max iterations / max cost).
 *
 * Cost tracking: each Gemini call reports its token usage; we apply the
 * Gemini 2.5 Flash rate card + grounding surcharges and sum across calls.
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_MAPS_MODEL = 'gemini-2.5-flash';

// --- Pricing (USD per token / per grounded call), 2026-05 rate card --------
// Gemini 2.5 Flash: $0.30 / 1M input, $2.50 / 1M output.
// Maps Grounding:   $25 / 1K grounded prompts (500 free / day).
// Google Search Grounding: $35 / 1K (after free tier).
// URL Context: no extra surcharge — just token cost.
const PRICING = {
  inputPerToken: 0.30 / 1_000_000,
  outputPerToken: 2.50 / 1_000_000,
  mapsGroundedCall: 0.025,
  searchGroundedCall: 0.035,
} as const;

// --- Safety caps ----------------------------------------------------------
const MAX_ITERATIONS = 6;
const MAX_COST_USD = 2.0; // hard stop ~ $2 / Fetch button click

function apiKey(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error('GEMINI_API_KEY manquante dans .env (Maps Grounding)');
  return k;
}

export interface MapsProspect {
  name: string;
  address?: string;
  phone?: string;
  website?: string;
  emails?: string[];
  rating?: number;
  reviewsCount?: number;
  googleMapsUri?: string;
  placeId?: string;
  summary?: string;
}

export interface PipelineStats {
  /** Total unique places returned by Maps Grounding across all iterations. */
  find: number;
  /** Total with a confirmed website. */
  withWebsite: number;
  /** Total with at least one email scraped from the website. */
  withEmails: number;
  /** What the caller asked for. */
  target: number;
  /** True iff withEmails >= target. */
  done: boolean;
  /** Number of pipeline iterations executed. */
  iterations: number;
  /** Number of Gemini API calls made (Maps + Search + urlContext combined). */
  apiCalls: number;
  /** Total estimated cost in USD. */
  costUsd: number;
}

export interface FetchMapsProspectsResult {
  prospects: MapsProspect[];
  grounded: boolean;
  stats: PipelineStats;
  widgetContextToken?: string;
}

export interface FetchMapsProspectsParams {
  mapsQuery: string;
  city: string;
  /** Target number of prospects WITH AT LEAST ONE EMAIL. The pipeline loops until reached. */
  limit?: number;
  latLng?: { latitude: number; longitude: number };
  model?: string;
}

// --- Wire types -----------------------------------------------------------
interface GroundingChunk {
  maps?: { uri?: string; title?: string; placeId?: string };
}
interface UsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}
interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: GroundingChunk[];
      googleMapsWidgetContextToken?: string;
    };
  }>;
  usageMetadata?: UsageMetadata;
  error?: { code: number; message: string; status: string };
}

interface CallCost {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

function tokenCost(usage: UsageMetadata | undefined): CallCost {
  const inT = usage?.promptTokenCount ?? 0;
  const outT = usage?.candidatesTokenCount ?? 0;
  return {
    inputTokens: inT,
    outputTokens: outT,
    costUsd: inT * PRICING.inputPerToken + outT * PRICING.outputPerToken,
  };
}

// =========================================================================
// Step 1 — Maps Grounding (canonical list of places, with exclusion)
// =========================================================================
interface MapsPlace {
  name: string;
  googleMapsUri?: string;
  placeId?: string;
}

async function callMapsGrounding(opts: {
  mapsQuery: string;
  city: string;
  limit: number;
  excludeNames: string[];
  latLng?: { latitude: number; longitude: number };
  model: string;
}): Promise<{ places: MapsPlace[]; widgetContextToken?: string; cost: CallCost; grounded: boolean }> {
  const excludeBlock =
    opts.excludeNames.length > 0
      ? `\n\nIMPORTANT: EXCLUDE these businesses that we already have, find DIFFERENT ones:\n${opts.excludeNames
          .map((n) => `- ${n}`)
          .join('\n')}`
      : '';

  const prompt = `Find up to ${opts.limit} REAL businesses matching "${opts.mapsQuery}" in or near "${opts.city}" on Google Maps. List them by name only. Skip chains/franchises unless that's the explicit query. Prefer businesses with recent reviews.${excludeBlock}`;

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ googleMaps: {} }],
  };
  if (opts.latLng) body.toolConfig = { retrievalConfig: { latLng: opts.latLng } };

  const url = `${GEMINI_BASE}/models/${opts.model}:generateContent`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Gemini Maps Grounding ${r.status}: ${await r.text()}`);
  const data = (await r.json()) as GeminiResponse;
  if (data.error) {
    throw new Error(`Gemini ${data.error.code} ${data.error.status}: ${data.error.message}`);
  }

  const cand = data.candidates?.[0];
  const chunks: GroundingChunk[] = cand?.groundingMetadata?.groundingChunks ?? [];
  const grounded = chunks.length > 0;
  const places: MapsPlace[] = [];
  const seen = new Set<string>();
  for (const ch of chunks) {
    const title = ch.maps?.title?.trim();
    if (!title) continue;
    const key = normalize(title);
    if (seen.has(key)) continue;
    seen.add(key);
    places.push({
      name: title,
      googleMapsUri: ch.maps?.uri,
      placeId: ch.maps?.placeId,
    });
  }

  const cost = tokenCost(data.usageMetadata);
  if (grounded) cost.costUsd += PRICING.mapsGroundedCall;

  return {
    places,
    widgetContextToken: cand?.groundingMetadata?.googleMapsWidgetContextToken,
    cost,
    grounded,
  };
}

// =========================================================================
// Step 2 — Enrich (Google Search grounding, batched)
// =========================================================================
interface EnrichedFields {
  website?: string;
  phone?: string;
  address?: string;
  rating?: number;
  reviewsCount?: number;
  summary?: string;
}

async function enrichPlacesWithSearch(
  places: MapsPlace[],
  city: string,
  model: string,
): Promise<{ enriched: Record<string, EnrichedFields>; cost: CallCost; grounded: boolean }> {
  if (places.length === 0) {
    return { enriched: {}, cost: { costUsd: 0, inputTokens: 0, outputTokens: 0 }, grounded: false };
  }

  const prompt = `For each of the following businesses in or near "${city}", use Google Search to find their official website, phone number, address, and rating.

Businesses:
${places.map((p, i) => `${i + 1}. ${p.name}`).join('\n')}

Output ONLY a JSON object, no markdown fences, no prose. Keys = EXACT business names above. Values = optional fields (omit unknown — do NOT invent):
{
  "${places[0]?.name ?? 'Business Name'}": {
    "website": "https://example.com",
    "phone": "+33 1 23 45 67 89",
    "address": "10 rue X, 75011 Paris",
    "rating": 4.6,
    "reviewsCount": 234,
    "summary": "1 line speciality"
  }
}

Rules:
- Include EVERY name from the list as a key (even with empty object).
- Website: homepage URL only, skip social media.
- Phone: E.164 if possible.
- OMIT fields you can't confidently find. Better empty than fabricated.`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
  };
  const url = `${GEMINI_BASE}/models/${model}:generateContent`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Gemini enrichment ${r.status}: ${await r.text()}`);
  const data = (await r.json()) as GeminiResponse;
  if (data.error) {
    throw new Error(`Gemini ${data.error.code} ${data.error.status}: ${data.error.message}`);
  }

  const cand = data.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  const grounded = (cand?.groundingMetadata?.groundingChunks?.length ?? 0) > 0;
  const cost = tokenCost(data.usageMetadata);
  if (grounded) cost.costUsd += PRICING.searchGroundedCall;

  return { enriched: parseEnrichmentJson(text), cost, grounded };
}

function parseEnrichmentJson(text: string): Record<string, EnrichedFields> {
  if (!text) return {};
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return {};
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    const out: Record<string, EnrichedFields> = {};
    for (const [name, raw] of Object.entries(parsed)) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      out[name] = {
        website: optStr(r.website),
        phone: optStr(r.phone),
        address: optStr(r.address),
        rating: typeof r.rating === 'number' ? r.rating : undefined,
        reviewsCount: typeof r.reviewsCount === 'number' ? r.reviewsCount : undefined,
        summary: optStr(r.summary),
      };
    }
    return out;
  } catch {
    return {};
  }
}

// =========================================================================
// Step 3 — Email extraction (URL Context, batched up to 20 URLs)
// =========================================================================
export async function extractEmailsFromWebsites(
  websites: string[],
  model: string = DEFAULT_MAPS_MODEL,
): Promise<{ emails: Record<string, string[]>; cost: CallCost }> {
  const urls = Array.from(new Set(websites.filter(Boolean))).slice(0, 20);
  if (urls.length === 0) {
    return { emails: {}, cost: { costUsd: 0, inputTokens: 0, outputTokens: 0 } };
  }

  const prompt = `Visit each of the following business websites and find up to 2 contact email addresses on each one. Look at the homepage, footer, contact / about / "mentions légales" / "qui sommes-nous" pages.

Websites:
${urls.map((u, i) => `${i + 1}. ${u}`).join('\n')}

Output ONLY a JSON object, no other text, no markdown fences. Keys = EXACT URLs above. Values = arrays of up to 2 real emails:
{
  "${urls[0]}": ["contact@example.com", "info@example.com"]${
    urls[1] ? `,\n  "${urls[1]}": ["hello@example2.com"]` : ''
  }
}

Rules:
- Max 2 emails per URL.
- ONLY emails actually written on the website. No guesses.
- Skip placeholders (noreply@, no-reply@, donotreply@).
- Empty array if none found.
- Include every URL as a key.`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ url_context: {} }],
  };
  const url = `${GEMINI_BASE}/models/${model}:generateContent`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Gemini urlContext ${r.status}: ${await r.text()}`);
  const data = (await r.json()) as GeminiResponse;
  if (data.error) {
    throw new Error(`Gemini ${data.error.code} ${data.error.status}: ${data.error.message}`);
  }

  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  return { emails: parseEmailsJson(text), cost: tokenCost(data.usageMetadata) };
}

function parseEmailsJson(text: string): Record<string, string[]> {
  if (!text) return {};
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return {};
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (!Array.isArray(v)) continue;
      const emails = v
        .filter((x): x is string => typeof x === 'string')
        .map((s) => s.trim())
        .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
        .filter((s) => !/^(no.?reply|donotreply)@/i.test(s))
        .slice(0, 2);
      out[k] = emails;
    }
    return out;
  } catch {
    return {};
  }
}

// =========================================================================
// Pipeline orchestrator — loops until N emails are reached
// =========================================================================
export async function fetchMapsProspects(
  params: FetchMapsProspectsParams,
): Promise<FetchMapsProspectsResult> {
  const model = params.model ?? DEFAULT_MAPS_MODEL;
  const target = params.limit ?? 15;

  const accumulated: MapsProspect[] = [];
  const seenNames = new Set<string>();
  let totalFind = 0;
  let totalCost = 0;
  let apiCalls = 0;
  let iterations = 0;
  let widgetContextToken: string | undefined;
  let mapsGroundedAtLeastOnce = false;

  while (iterations < MAX_ITERATIONS && totalCost < MAX_COST_USD) {
    iterations++;
    const withEmailsSoFar = accumulated.filter((p) => p.emails && p.emails.length > 0).length;
    if (withEmailsSoFar >= target) break;

    const remaining = target - withEmailsSoFar;
    // Over-fetch each iteration: many places will lack website or email, so
    // ask for ~3x the gap, capped at 25 (Maps Grounding ceiling per call).
    const stepLimit = Math.min(25, Math.max(5, remaining * 3));

    // 1. Maps Grounding (with exclusion of already-seen names)
    let mapsRes;
    try {
      mapsRes = await callMapsGrounding({
        mapsQuery: params.mapsQuery,
        city: params.city,
        limit: stepLimit,
        excludeNames: Array.from(seenNames).slice(0, 40), // cap exclusion list size
        latLng: params.latLng,
        model,
      });
    } catch (e) {
      console.warn(`[maps_grounding] iteration ${iterations} Maps failed: ${(e as Error).message}`);
      break;
    }
    apiCalls++;
    totalCost += mapsRes.cost.costUsd;
    if (mapsRes.grounded) mapsGroundedAtLeastOnce = true;
    widgetContextToken = widgetContextToken ?? mapsRes.widgetContextToken;

    const newPlaces = mapsRes.places.filter((pl) => !seenNames.has(normalize(pl.name)));
    newPlaces.forEach((pl) => seenNames.add(normalize(pl.name)));
    totalFind += newPlaces.length;
    if (newPlaces.length === 0) break; // Maps has nothing new to give

    // 2. Enrich
    let enrichRes;
    try {
      enrichRes = await enrichPlacesWithSearch(newPlaces, params.city, model);
    } catch (e) {
      console.warn(`[maps_grounding] iteration ${iterations} enrich failed: ${(e as Error).message}`);
      enrichRes = { enriched: {}, cost: { costUsd: 0, inputTokens: 0, outputTokens: 0 }, grounded: false };
    }
    apiCalls++;
    totalCost += enrichRes.cost.costUsd;

    const newProspects: MapsProspect[] = newPlaces.map((pl) => {
      const exact = enrichRes.enriched[pl.name];
      const fuzzy =
        exact ??
        Object.entries(enrichRes.enriched).find(
          ([k]) => normalize(k) === normalize(pl.name),
        )?.[1];
      const fields = fuzzy ?? {};
      return {
        name: pl.name,
        website: fields.website,
        phone: fields.phone,
        address: fields.address,
        rating: fields.rating,
        reviewsCount: fields.reviewsCount,
        summary: fields.summary,
        googleMapsUri: pl.googleMapsUri,
        placeId: pl.placeId,
      };
    });

    // 3. Filter to website-only + extract emails
    const websiteProspects = newProspects.filter((p) => p.website);
    if (websiteProspects.length > 0 && totalCost < MAX_COST_USD) {
      try {
        const emailsRes = await extractEmailsFromWebsites(
          websiteProspects.map((p) => p.website!),
          model,
        );
        apiCalls++;
        totalCost += emailsRes.cost.costUsd;
        for (const p of websiteProspects) {
          const found = p.website ? emailsRes.emails[p.website] : undefined;
          if (found && found.length > 0) p.emails = found.slice(0, 2);
        }
      } catch (e) {
        console.warn(
          `[maps_grounding] iteration ${iterations} emails failed: ${(e as Error).message}`,
        );
      }
    }

    accumulated.push(...websiteProspects);
  }

  // Final list: only prospects WITH emails (per spec), trimmed to target.
  const final = accumulated.filter((p) => p.emails && p.emails.length > 0).slice(0, target);

  const stats: PipelineStats = {
    find: totalFind,
    withWebsite: accumulated.length,
    withEmails: final.length,
    target,
    done: final.length >= target,
    iterations,
    apiCalls,
    costUsd: Number(totalCost.toFixed(4)),
  };

  return {
    prospects: final,
    grounded: mapsGroundedAtLeastOnce,
    stats,
    widgetContextToken,
  };
}

// --- helpers --------------------------------------------------------------
function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}
function optStr(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s.length > 0 ? s : undefined;
}
