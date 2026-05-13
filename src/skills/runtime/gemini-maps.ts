/**
 * Gemini API — Google Maps Grounding wrapper.
 *
 * The `googleMaps` tool grounds the model on real Google Maps data:
 *   tools: [{ googleMaps: {} }]
 *
 * Native grounding chunks expose only `title` (place name), `uri` (Maps link),
 * and `placeId`. Phone numbers, websites, ratings etc. are NOT structured
 * fields — Gemini may surface them inside review snippets / textual context.
 *
 * Strategy here: we prompt Gemini to emit a JSON array of prospects with all
 * the contact details it can find, then we parse it and merge with the
 * grounding chunks (so each prospect carries an authoritative `placeId` +
 * Maps URI from the API surface).
 *
 * Pricing: $25 / 1K grounded prompts, 500 free / day. Billed only when at
 * least one Maps source is returned.
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
  /** Phone number (digits) if Gemini surfaced one — may be missing. */
  phone?: string;
  /** Business website URL if known — used as the source for email extraction. */
  website?: string;
  /** Up to 2 contact emails scraped from the business website via Gemini urlContext. */
  emails?: string[];
  /** Google rating 1.0-5.0 if known. */
  rating?: number | undefined;
  /** Number of Google reviews if known. */
  reviewsCount?: number;
  /** Google Maps URI (deep link) for this exact place. */
  googleMapsUri?: string;
  /** Stable place identifier from Google. */
  placeId?: string;
  /** Free-form 1-line summary from Gemini (what's special, opening hours hint, etc.). */
  summary?: string;
}

export interface FetchMapsProspectsResult {
  prospects: MapsProspect[];
  /** Diagnostic: any caveats / notes from the model (e.g. "no phone in snippets"). */
  notes?: string;
  /** Was the response actually grounded on Maps (i.e., billed)? */
  grounded: boolean;
  /** Raw Maps Widget context token if `enableWidget` was set. */
  widgetContextToken?: string;
}

export interface FetchMapsProspectsParams {
  /** What businesses to look for — e.g. "salons de coiffure", "kinésithérapeutes". */
  mapsQuery: string;
  /** City / neighbourhood / area — e.g. "Paris 11e", "Lyon centre". */
  city: string;
  /** How many prospects to return (model is free to return fewer). Default 15. */
  limit?: number;
  /** Optional lat/lng — sharpens grounding to a precise area. */
  latLng?: { latitude: number; longitude: number };
  /** Override model. Default: gemini-2.5-flash. */
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

/**
 * Pull a JSON array out of a free-form model response.
 * Handles ```json fences, leading prose, etc.
 */
function extractJsonArray(text: string): unknown[] {
  if (!text) return [];
  // Strip code fences
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  // Find first [ and last ]
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  const slice = cleaned.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Call Gemini with Google Maps grounding and ask it to enumerate prospects
 * matching `mapsQuery` in `city`. Returns a normalized list.
 */
export async function fetchMapsProspects(
  params: FetchMapsProspectsParams,
): Promise<FetchMapsProspectsResult> {
  const { mapsQuery, city, limit = 15, latLng, model = DEFAULT_MAPS_MODEL } = params;

  const prompt = `You are a B2B prospect researcher. Use Google Maps to find up to ${limit} businesses matching "${mapsQuery}" in or near "${city}".

For each business, return the most accurate information you can ground from Google Maps and review snippets. Be honest: if a field is unknown, OMIT it (do not invent).

OUTPUT FORMAT — return ONLY a JSON array of objects, no other prose, no markdown fences. Each object has these fields (omit any unknown):
[
  {
    "name": "exact business name as on Maps",
    "address": "street, city, zip",
    "phone": "+33 1 23 45 67 89 (E.164 if possible)",
    "website": "https://...",
    "rating": 4.5,
    "reviewsCount": 234,
    "summary": "1 short line — speciality, hook, or notable detail"
  }
]

Rules:
- Up to ${limit} results, real businesses only (no chains/franchises unless that's the explicit query).
- Phone & website: include ONLY if you can confirm them from Maps data / website snippets / review citations. Leave out otherwise.
- Skip duplicates (same establishment).
- Order by relevance to "${mapsQuery}" + apparent activity (recent reviews).`;

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ googleMaps: {} }],
  };
  if (latLng) {
    body.toolConfig = { retrievalConfig: { latLng } };
  }

  const url = `${GEMINI_BASE}/models/${model}:generateContent`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(`Gemini Maps Grounding ${r.status}: ${await r.text()}`);
  }
  const data = (await r.json()) as GeminiResponse;
  if (data.error) {
    throw new Error(`Gemini error ${data.error.code} ${data.error.status}: ${data.error.message}`);
  }

  const cand = data.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  const chunks: GroundingChunk[] = cand?.groundingMetadata?.groundingChunks ?? [];

  const rawProspects = extractJsonArray(text) as Record<string, unknown>[];

  // Merge grounding chunks (Maps URI + placeId) with Gemini's extracted prospects by name match.
  const chunkByName = new Map<string, GroundingChunk['maps']>();
  for (const ch of chunks) {
    if (ch.maps?.title) chunkByName.set(normalize(ch.maps.title), ch.maps);
  }

  const prospects: MapsProspect[] = rawProspects.map((raw) => {
    const name = String(raw.name ?? '').trim();
    const grounded = chunkByName.get(normalize(name));
    return {
      name,
      address: optStr(raw.address),
      phone: optStr(raw.phone),
      website: optStr(raw.website),
      rating: typeof raw.rating === 'number' ? raw.rating : undefined,
      reviewsCount:
        typeof raw.reviewsCount === 'number' ? raw.reviewsCount : undefined,
      summary: optStr(raw.summary),
      googleMapsUri: grounded?.uri,
      placeId: grounded?.placeId,
    };
  }).filter((p) => p.name.length > 0);

  // Also surface any grounding chunks Gemini referenced but didn't echo in its JSON.
  const echoedNames = new Set(prospects.map((p) => normalize(p.name)));
  for (const ch of chunks) {
    if (!ch.maps?.title) continue;
    const n = normalize(ch.maps.title);
    if (echoedNames.has(n)) continue;
    prospects.push({
      name: ch.maps.title,
      googleMapsUri: ch.maps.uri,
      placeId: ch.maps.placeId,
    });
  }

  // Per spec: filter to businesses that have a website (no website ⇒ no scrapable email).
  const withWebsite = prospects.filter((p) => p.website && p.website.length > 0);

  // Enrich with up to 2 emails per website via Gemini urlContext.
  if (withWebsite.length > 0) {
    try {
      const websites = withWebsite.map((p) => p.website!);
      const emailsByUrl = await extractEmailsFromWebsites(websites, model);
      for (const p of withWebsite) {
        const found = p.website ? emailsByUrl[p.website] : undefined;
        if (found && found.length > 0) p.emails = found.slice(0, 2);
      }
    } catch (e) {
      // Don't fail the whole skill if email enrichment errors — return prospects without emails.
      console.warn(`[maps_grounding] email enrichment failed: ${(e as Error).message}`);
    }
  }

  return {
    prospects: withWebsite,
    grounded: chunks.length > 0,
    widgetContextToken: cand?.groundingMetadata?.googleMapsWidgetContextToken,
  };
}

/**
 * Batched email extraction. Asks Gemini (with the `url_context` tool) to visit
 * each website and return up to 2 contact emails per URL.
 *
 * One Gemini call for the whole batch — much cheaper than N calls.
 * urlContext max is 20 URLs per request, so we cap and de-dup.
 */
export async function extractEmailsFromWebsites(
  websites: string[],
  model: string = DEFAULT_MAPS_MODEL,
): Promise<Record<string, string[]>> {
  // De-dup and clamp to 20 URLs (urlContext API limit).
  const urls = Array.from(new Set(websites.filter(Boolean))).slice(0, 20);
  if (urls.length === 0) return {};

  const prompt = `Visit each of the following business websites and find up to 2 contact email addresses on each one. Look at the homepage, footer, contact / about / "mentions légales" / "qui sommes-nous" pages.

Websites:
${urls.map((u, i) => `${i + 1}. ${u}`).join('\n')}

Output ONLY a JSON object, no other text, no markdown fences. Keys are the EXACT URLs above, values are arrays of up to 2 real emails found on the site:
{
  "${urls[0]}": ["contact@example.com", "info@example.com"],
  "${urls[1] ?? 'https://example2.com'}": ["hello@example2.com"]
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
  if (!r.ok) {
    throw new Error(`Gemini urlContext ${r.status}: ${await r.text()}`);
  }

  const data = (await r.json()) as GeminiResponse;
  if (data.error) {
    throw new Error(
      `Gemini error ${data.error.code} ${data.error.status}: ${data.error.message}`,
    );
  }

  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  return extractJsonObject(text);
}

function extractJsonObject(text: string): Record<string, string[]> {
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
        .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) // basic email shape
        .filter((s) => !/^(no.?reply|donotreply)@/i.test(s)) // strip placeholders
        .slice(0, 2);
      out[k] = emails;
    }
    return out;
  } catch {
    return {};
  }
}

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}
function optStr(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s.length > 0 ? s : undefined;
}
