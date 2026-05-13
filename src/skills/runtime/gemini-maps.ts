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

export interface IterationTrace {
  /** 1-indexed iteration number. */
  iteration: number;
  /** Was the JSON happy path used (true) or the Search-enrich fallback (false)? */
  jsonPath: boolean;
  /** New unique places returned by Maps Grounding this iteration. */
  find: number;
  /** Of those, how many had a confirmed website. */
  withWebsite: number;
  /** Of those, how many had at least one email scraped. */
  withEmails: number;
  /** Cost USD of the Maps Grounding call. */
  costMaps: number;
  /** Cost USD of the Search Enrich call (0 on the JSON happy path). */
  costEnrich: number;
  /** Cost USD of the URL Context email scraping call (0 if no websites). */
  costEmails: number;
  /** Sum of the three above. */
  costTotal: number;
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
  /** Per-iteration breakdown for UI visibility. */
  trace: IterationTrace[];
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
// Step 1 — Maps Grounding (filter has-website + return JSON details)
// =========================================================================
interface MapsPlace {
  name: string;
  googleMapsUri?: string;
  placeId?: string;
}

interface MapsCallResult {
  /** Places parsed from the JSON text response (may include website/phone/…). */
  jsonPlaces: Array<Partial<MapsProspect> & { name: string }>;
  /** Places extracted from grounding chunks (always name + uri + placeId only). */
  chunks: MapsPlace[];
  widgetContextToken?: string;
  cost: CallCost;
  grounded: boolean;
}

async function callMapsGrounding(opts: {
  mapsQuery: string;
  city: string;
  limit: number;
  excludeNames: string[];
  latLng?: { latitude: number; longitude: number };
  model: string;
}): Promise<MapsCallResult> {
  const excludeBlock =
    opts.excludeNames.length > 0
      ? `\n\nEXCLUDE these we already have, find DIFFERENT ones:\n${opts.excludeNames
          .map((n) => `- ${n}`)
          .join('\n')}`
      : '';

  // Upstream filter: tell Maps Grounding to only surface places WITH a website
  // AND ask Gemini to emit a JSON array including the website URL. This
  // (a) removes dead-end places from the funnel and (b) lets us skip the
  // Search enrich step entirely on the happy path.
  const prompt = `Find up to ${opts.limit} REAL businesses matching "${opts.mapsQuery}" in or near "${opts.city}" on Google Maps.

CRITICAL: Only include businesses that **have a website listed on their Google Maps page**. SKIP any business without a website — we cannot scrape its email downstream.

Skip chains/franchises unless that's the explicit query. Prefer businesses with recent reviews.${excludeBlock}

Output ONLY a JSON array (no markdown fences, no prose around it). For each business include name + website + any phone/address/rating you can see on the Maps fiche:
[
  {
    "name": "exact business name as on Maps",
    "website": "https://example.com",
    "phone": "+33 1 23 45 67 89",
    "address": "10 rue X, 75011 Paris",
    "rating": 4.6,
    "reviewsCount": 234
  }
]

Rules:
- Website is REQUIRED for every entry — if a place has no website on Maps, do not include it.
- Phone / address / rating / reviewsCount: include if visible, omit otherwise.
- Do NOT invent data.`;

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
  const text = cand?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  const groundingChunks: GroundingChunk[] = cand?.groundingMetadata?.groundingChunks ?? [];
  const grounded = groundingChunks.length > 0;

  // Parse the JSON array Gemini was asked to emit.
  const jsonPlaces = parseMapsPlacesJson(text);

  // Always collect chunks too — they carry the authoritative mapsUri + placeId.
  const chunks: MapsPlace[] = [];
  const seen = new Set<string>();
  for (const ch of groundingChunks) {
    const title = ch.maps?.title?.trim();
    if (!title) continue;
    const key = normalize(title);
    if (seen.has(key)) continue;
    seen.add(key);
    chunks.push({
      name: title,
      googleMapsUri: ch.maps?.uri,
      placeId: ch.maps?.placeId,
    });
  }

  const cost = tokenCost(data.usageMetadata);
  if (grounded) cost.costUsd += PRICING.mapsGroundedCall;

  return {
    jsonPlaces,
    chunks,
    widgetContextToken: cand?.groundingMetadata?.googleMapsWidgetContextToken,
    cost,
    grounded,
  };
}

function parseMapsPlacesJson(
  text: string,
): Array<Partial<MapsProspect> & { name: string }> {
  if (!text) return [];
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const arr = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    const out: Array<Partial<MapsProspect> & { name: string }> = [];
    for (const raw of arr) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      const name = typeof r.name === 'string' ? r.name.trim() : '';
      if (!name) continue;
      out.push({
        name,
        website: optStr(r.website),
        phone: optStr(r.phone),
        address: optStr(r.address),
        rating: typeof r.rating === 'number' ? r.rating : undefined,
        reviewsCount:
          typeof r.reviewsCount === 'number' ? r.reviewsCount : undefined,
        summary: optStr(r.summary),
      });
    }
    return out;
  } catch {
    return [];
  }
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
  const trace: IterationTrace[] = [];
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
    // Maps now pre-filters for has-website, so we can ask closer to the gap.
    // Keep a small buffer for places whose website doesn't yield emails.
    const stepLimit = Math.min(25, Math.max(5, Math.ceil(remaining * 1.8)));

    // 1. Maps Grounding (filter has-website + emit JSON details)
    let mapsRes;
    try {
      mapsRes = await callMapsGrounding({
        mapsQuery: params.mapsQuery,
        city: params.city,
        limit: stepLimit,
        excludeNames: Array.from(seenNames).slice(0, 40),
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

    // Merge JSON places with chunks (chunks carry mapsUri + placeId).
    // Strategy: if Gemini emitted parseable JSON, trust it (filter for has-website
    // happened upstream). Otherwise fall back to chunks + Search enrich.
    let newProspects: MapsProspect[];
    let costEnrich = 0;
    const jsonPath = mapsRes.jsonPlaces.length > 0;

    if (jsonPath) {
      // Happy path: Maps gave us structured data already
      newProspects = mapsRes.jsonPlaces
        .filter((jp) => !seenNames.has(normalize(jp.name)))
        .map((jp) => {
          const chunk = mapsRes.chunks.find(
            (c) => normalize(c.name) === normalize(jp.name),
          );
          return {
            name: jp.name,
            website: jp.website,
            phone: jp.phone,
            address: jp.address,
            rating: jp.rating,
            reviewsCount: jp.reviewsCount,
            summary: jp.summary,
            googleMapsUri: chunk?.googleMapsUri,
            placeId: chunk?.placeId,
          };
        });
    } else if (mapsRes.chunks.length > 0) {
      // Fallback path: JSON parsing failed → enrich chunks via googleSearch
      const chunkPlaces: MapsPlace[] = mapsRes.chunks.filter(
        (c) => !seenNames.has(normalize(c.name)),
      );
      let enrichRes;
      try {
        enrichRes = await enrichPlacesWithSearch(chunkPlaces, params.city, model);
      } catch (e) {
        console.warn(
          `[maps_grounding] iter ${iterations} enrich failed: ${(e as Error).message}`,
        );
        enrichRes = {
          enriched: {},
          cost: { costUsd: 0, inputTokens: 0, outputTokens: 0 },
          grounded: false,
        };
      }
      apiCalls++;
      costEnrich = enrichRes.cost.costUsd;
      totalCost += costEnrich;
      newProspects = chunkPlaces.map((pl) => {
        const fuzzy =
          enrichRes.enriched[pl.name] ??
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
    } else {
      // Maps returned nothing — record empty trace + stop
      newProspects = [];
    }

    // Track seen + counts BEFORE filtering by website (so exclusion stays accurate)
    newProspects.forEach((p) => seenNames.add(normalize(p.name)));
    const findCount = newProspects.length;
    totalFind += findCount;

    // 2. Filter to website-only
    const websiteProspects = newProspects.filter((p) => p.website);

    // 3. Extract up to 2 emails per website (batched URL Context call)
    let costEmails = 0;
    let withEmailsThisIter = 0;
    if (websiteProspects.length > 0 && totalCost < MAX_COST_USD) {
      try {
        const emailsRes = await extractEmailsFromWebsites(
          websiteProspects.map((p) => p.website!),
          model,
        );
        apiCalls++;
        costEmails = emailsRes.cost.costUsd;
        totalCost += costEmails;
        for (const p of websiteProspects) {
          const found = p.website ? emailsRes.emails[p.website] : undefined;
          if (found && found.length > 0) {
            p.emails = found.slice(0, 2);
            withEmailsThisIter++;
          }
        }
      } catch (e) {
        console.warn(
          `[maps_grounding] iter ${iterations} emails failed: ${(e as Error).message}`,
        );
      }
    }

    accumulated.push(...websiteProspects);

    // Record this iteration in the trace
    trace.push({
      iteration: iterations,
      jsonPath,
      find: findCount,
      withWebsite: websiteProspects.length,
      withEmails: withEmailsThisIter,
      costMaps: Number(mapsRes.cost.costUsd.toFixed(4)),
      costEnrich: Number(costEnrich.toFixed(4)),
      costEmails: Number(costEmails.toFixed(4)),
      costTotal: Number(
        (mapsRes.cost.costUsd + costEnrich + costEmails).toFixed(4),
      ),
    });

    if (findCount === 0) break; // Maps has no more new places to give
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
    trace,
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
