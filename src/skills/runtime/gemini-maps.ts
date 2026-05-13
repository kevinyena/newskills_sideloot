/**
 * Gemini API — local prospect pipeline.
 *
 * Three-step flow:
 *
 *   1. **Maps Grounding** (`tools: [{ googleMaps: {} }]`) — returns
 *      `groundingChunks` with each place's name + Maps URI + placeId.
 *      This is the authoritative list of real, geo-relevant businesses.
 *
 *   2. **Enrich** (`tools: [{ google_search: {} }]`) — single batched call
 *      that asks Gemini to look up each place's website and phone using
 *      web search. Returns structured JSON keyed by name.
 *
 *   3. **Email extraction** (`tools: [{ url_context: {} }]`) — visits each
 *      surviving website (post website-filter) and extracts up to 2
 *      contact emails per site in one batched call.
 *
 * Why two enrichment calls instead of one Maps prompt that returns JSON?
 * Maps Grounding outputs natural-language summaries that don't reliably
 * parse as JSON. Chunks ARE structured but only carry title/uri/placeId
 * — phone / website are not exposed. Hence the split.
 *
 * Pricing:
 *   - Maps Grounding: $25 / 1K grounded prompts, 500 free / day
 *   - Google Search Grounding: same model, no extra grounding charge for Search
 *   - URL Context: included with the model call (up to 20 URLs per request)
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_MAPS_MODEL = 'gemini-2.5-flash';

function apiKey(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error('GEMINI_API_KEY manquante dans .env (Maps Grounding)');
  return k;
}

export interface MapsProspect {
  /** Place name as written on Maps. */
  name: string;
  /** Full street address if available. */
  address?: string;
  /** Phone number (digits) if discovered — may be missing. */
  phone?: string;
  /** Business website URL if known — used as the source for email extraction. */
  website?: string;
  /** Up to 2 contact emails scraped from the business website via Gemini urlContext. */
  emails?: string[];
  /** Google rating 1.0-5.0 if known. */
  rating?: number;
  /** Number of Google reviews if known. */
  reviewsCount?: number;
  /** Google Maps URI (deep link) for this exact place. */
  googleMapsUri?: string;
  /** Stable place identifier from Google. */
  placeId?: string;
  /** Free-form 1-line summary from Gemini. */
  summary?: string;
}

export interface FetchMapsProspectsResult {
  prospects: MapsProspect[];
  /** Was the response actually grounded on Maps (i.e., billed)? */
  grounded: boolean;
  /** Diagnostic: raw counts at each pipeline stage. */
  stats?: {
    mapsChunks: number;
    enriched: number;
    withWebsite: number;
    withEmails: number;
  };
  widgetContextToken?: string;
}

export interface FetchMapsProspectsParams {
  mapsQuery: string;
  city: string;
  limit?: number;
  latLng?: { latitude: number; longitude: number };
  model?: string;
}

interface GroundingChunk {
  maps?: { uri?: string; title?: string; placeId?: string };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: GroundingChunk[];
      googleMapsWidgetContextToken?: string;
    };
  }>;
  error?: { code: number; message: string; status: string };
}

// ============================================================
// Step 1 — Maps Grounding (canonical list of places)
// ============================================================

interface MapsPlace {
  name: string;
  googleMapsUri?: string | undefined;
  placeId?: string | undefined;
}

async function callMapsGrounding(
  params: FetchMapsProspectsParams,
): Promise<{ places: MapsPlace[]; widgetContextToken?: string }> {
  const { mapsQuery, city, limit = 15, latLng, model = DEFAULT_MAPS_MODEL } = params;

  const prompt = `Find up to ${limit} businesses matching "${mapsQuery}" in or near "${city}" on Google Maps. List them by name only. Skip chains/franchises unless that's the explicit query. Prefer businesses with recent reviews.`;

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ googleMaps: {} }],
  };
  if (latLng) body.toolConfig = { retrievalConfig: { latLng } };

  const url = `${GEMINI_BASE}/models/${model}:generateContent`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Gemini Maps Grounding ${r.status}: ${await r.text()}`);
  const data = (await r.json()) as GeminiResponse;
  if (data.error) {
    throw new Error(`Gemini error ${data.error.code} ${data.error.status}: ${data.error.message}`);
  }

  const cand = data.candidates?.[0];
  const chunks: GroundingChunk[] = cand?.groundingMetadata?.groundingChunks ?? [];
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

  return {
    places,
    widgetContextToken: cand?.groundingMetadata?.googleMapsWidgetContextToken,
  };
}

// ============================================================
// Step 2 — Enrich each place with website / phone / details
//          via Gemini + googleSearch grounding (batched, one call)
// ============================================================

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
): Promise<Record<string, EnrichedFields>> {
  if (places.length === 0) return {};

  const prompt = `For each of the following businesses in or near "${city}", use Google Search to find their official website, phone number, address, and rating.

Businesses:
${places.map((p, i) => `${i + 1}. ${p.name}`).join('\n')}

Output ONLY a JSON object, no markdown fences, no prose around it. Keys are the EXACT business names from above. Values are objects with these optional fields (omit if unknown — do NOT invent):
{
  "${places[0]?.name ?? 'Business Name'}": {
    "website": "https://example.com",
    "phone": "+33 1 23 45 67 89",
    "address": "10 rue X, 75011 Paris",
    "rating": 4.6,
    "reviewsCount": 234,
    "summary": "1 line — speciality or hook"
  }
}

Rules:
- Include EVERY business name from the list as a key.
- Website: only the homepage URL. Skip social media links.
- Phone: E.164 if possible.
- If a field can't be confidently found, OMIT it (do not return null or "").
- Do not fabricate data — better to omit than guess.`;

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
    throw new Error(
      `Gemini error ${data.error.code} ${data.error.status}: ${data.error.message}`,
    );
  }
  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';

  return parseEnrichmentJson(text);
}

function parseEnrichmentJson(text: string): Record<string, EnrichedFields> {
  if (!text) return {};
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return {};
  const slice = cleaned.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice) as Record<string, unknown>;
    const out: Record<string, EnrichedFields> = {};
    for (const [name, raw] of Object.entries(parsed)) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      out[name] = {
        website: optStr(r.website),
        phone: optStr(r.phone),
        address: optStr(r.address),
        rating: typeof r.rating === 'number' ? r.rating : undefined,
        reviewsCount:
          typeof r.reviewsCount === 'number' ? r.reviewsCount : undefined,
        summary: optStr(r.summary),
      };
    }
    return out;
  } catch {
    return {};
  }
}

// ============================================================
// Step 3 — Email extraction via urlContext (batched, one call)
// ============================================================

export async function extractEmailsFromWebsites(
  websites: string[],
  model: string = DEFAULT_MAPS_MODEL,
): Promise<Record<string, string[]>> {
  const urls = Array.from(new Set(websites.filter(Boolean))).slice(0, 20);
  if (urls.length === 0) return {};

  const prompt = `Visit each of the following business websites and find up to 2 contact email addresses on each one. Look at the homepage, footer, contact / about / "mentions légales" / "qui sommes-nous" pages.

Websites:
${urls.map((u, i) => `${i + 1}. ${u}`).join('\n')}

Output ONLY a JSON object, no other text, no markdown fences. Keys are the EXACT URLs above, values are arrays of up to 2 real emails found on the site:
{
  "${urls[0]}": ["contact@example.com", "info@example.com"]${
    urls[1] ? `,\n  "${urls[1]}": ["hello@example2.com"]` : ''
  }
}

Rules:
- Maximum 2 emails per URL.
- ONLY include emails actually written on the website. Do NOT invent or guess.
- Skip placeholders like noreply@, no-reply@, donotreply@.
- If no email is found for a URL, set its value to [].
- Include every URL from the list as a key, even if its value is [].`;

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
    throw new Error(
      `Gemini error ${data.error.code} ${data.error.status}: ${data.error.message}`,
    );
  }
  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  return parseEmailsJson(text);
}

function parseEmailsJson(text: string): Record<string, string[]> {
  if (!text) return {};
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return {};
  const slice = cleaned.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice) as Record<string, unknown>;
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

// ============================================================
// Pipeline orchestrator
// ============================================================

export async function fetchMapsProspects(
  params: FetchMapsProspectsParams,
): Promise<FetchMapsProspectsResult> {
  const model = params.model ?? DEFAULT_MAPS_MODEL;

  // 1. Maps Grounding — canonical list of real places
  const { places, widgetContextToken } = await callMapsGrounding(params);
  if (places.length === 0) {
    return { prospects: [], grounded: false, stats: { mapsChunks: 0, enriched: 0, withWebsite: 0, withEmails: 0 } };
  }

  // 2. Enrich with website / phone / address via googleSearch grounding
  let enrichedByName: Record<string, EnrichedFields> = {};
  try {
    enrichedByName = await enrichPlacesWithSearch(places, params.city, model);
  } catch (e) {
    console.warn(`[maps_grounding] enrichment failed: ${(e as Error).message}`);
  }

  const prospects: MapsProspect[] = places.map((pl) => {
    // Lookup tolerant of slight casing/whitespace differences.
    const exact = enrichedByName[pl.name];
    const fuzzy = exact ?? Object.entries(enrichedByName).find(
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

  // 3. Filter to website-only (per skill spec)
  const withWebsite = prospects.filter((p) => p.website && p.website.length > 0);

  // 4. Extract up to 2 emails per website (batched urlContext call)
  let withEmailsCount = 0;
  if (withWebsite.length > 0) {
    try {
      const websites = withWebsite.map((p) => p.website!);
      const emailsByUrl = await extractEmailsFromWebsites(websites, model);
      for (const p of withWebsite) {
        const found = p.website ? emailsByUrl[p.website] : undefined;
        if (found && found.length > 0) {
          p.emails = found.slice(0, 2);
          withEmailsCount++;
        }
      }
    } catch (e) {
      console.warn(`[maps_grounding] email extraction failed: ${(e as Error).message}`);
    }
  }

  return {
    prospects: withWebsite,
    grounded: places.length > 0,
    stats: {
      mapsChunks: places.length,
      enriched: Object.keys(enrichedByName).length,
      withWebsite: withWebsite.length,
      withEmails: withEmailsCount,
    },
    widgetContextToken,
  };
}

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}
function optStr(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s.length > 0 ? s : undefined;
}
