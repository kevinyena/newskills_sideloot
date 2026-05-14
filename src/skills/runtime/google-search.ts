/**
 * Lightweight Google Search "scraper" for finding X (Twitter) profile URLs.
 *
 * The trick: a query like
 *   (site:x.com OR site:twitter.com) ("trader" OR "ink") -inurl:status -inurl:search
 * returns Google SERP pages where the only URLs (matching site:) are X profile
 * pages whose CONTENT contains the keywords — i.e., X bios containing the term.
 *
 * No Apify, no Google Custom Search API key, no SerpAPI. Direct fetch +
 * extract X handles via regex from the raw HTML.
 *
 * Caveats:
 *   - Google rate-limits aggressive scraping. Light use (a few queries/day) is fine.
 *     Heavy use → CAPTCHA challenge / 429 / IP block.
 *   - Google's HTML structure changes. If parsing breaks, fix the regex.
 *   - X profile URLs are `x.com/USERNAME` (no slash after) — we exclude
 *     `/status/...`, `/search`, etc. via `-inurl:status -inurl:search` AND
 *     a reserved-handles blocklist.
 */

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// X paths that are NOT user profiles
const RESERVED_X_HANDLES = new Set([
  'search', 'home', 'explore', 'i', 'intent', 'login', 'signup', 'oauth',
  'compose', 'about', 'tos', 'privacy', 'jobs', 'help', 'pricing',
  'developers', 'settings', 'notifications', 'messages', 'lists',
  'topics', 'moments', 'hashtag', 'who_to_follow', 'tweetdeck',
  'download', 'verified', 'verify', 'press', 'rules', 'safety',
  'media', 'translate', 'share',
]);

export interface XProfileFromGoogle {
  /** Handle without leading @, lowercased for dedupe. */
  handle: string;
  /** Canonical profile URL we land on (always x.com/HANDLE). */
  url: string;
}

export interface GoogleSearchResult {
  /** Unique X profiles surfaced by Google. */
  profiles: XProfileFromGoogle[];
  /** The exact query string passed to google.com/search. */
  query: string;
  /** Raw HTML size (for debug). */
  htmlBytes: number;
}

export interface GoogleSearchParams {
  /** Bio keywords (we wrap each in quotes if multi-word, OR them together). */
  keywords: string[];
  /** Asked Google for this many results (Google may cap to ~10-30). */
  num?: number;
  /** Result offset (for pagination, `start=10`, `start=20`, etc.). */
  start?: number;
  /** Site filter — defaults to "(site:x.com OR site:twitter.com)". */
  siteFilter?: string;
  /** Extra exclusions — default excludes URL fragments like status/, search. */
  exclusions?: string;
}

/**
 * Run ONE Google search and return all X handles found in the result HTML.
 *
 * Doesn't try to parse titles/snippets — that's fragile across Google's
 * HTML changes. Just regex-extract X profile URLs and dedupe handles.
 * Downstream the caller batches `lookupUsersByUsernames()` via the X API
 * to get the actual bios.
 */
export async function searchGoogleForXProfiles(
  params: GoogleSearchParams,
): Promise<GoogleSearchResult> {
  const keywords = params.keywords.filter((k) => k.trim().length > 0);
  if (keywords.length === 0) {
    throw new Error('keywords vide — rien à chercher.');
  }

  // Quote multi-word keywords so Google treats them as exact phrases.
  const kwPart = keywords
    .map((k) => (k.includes(' ') ? `"${k.replace(/"/g, '')}"` : `"${k}"`))
    .join(' OR ');
  const siteFilter = params.siteFilter ?? '(site:x.com OR site:twitter.com)';
  const exclusions = params.exclusions ?? '-inurl:status -inurl:search';
  const query = `${siteFilter} (${kwPart}) ${exclusions}`;

  const num = Math.min(Math.max(params.num ?? 30, 10), 100);
  const start = params.start ?? 0;
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${num}&start=${start}&hl=en`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': DESKTOP_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Cache-Control': 'no-cache',
    },
  });

  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    throw new Error(`Google search HTTP ${res.status}: ${body}`);
  }
  const html = await res.text();

  if (
    html.includes('Our systems have detected unusual traffic') ||
    html.includes('id="captcha-form"') ||
    html.includes('CAPTCHA') ||
    /<title>[^<]*Sorry/i.test(html)
  ) {
    throw new Error(
      'Google a affiché un CAPTCHA / page "Sorry" — la machine est temporairement bloquée. Attends 15-30 min ou utilise un autre IP.',
    );
  }

  const profiles = extractXProfilesFromHtml(html);
  return { profiles, query, htmlBytes: html.length };
}

function extractXProfilesFromHtml(html: string): XProfileFromGoogle[] {
  const seen = new Set<string>();
  const profiles: XProfileFromGoogle[] = [];

  // Match `x.com/HANDLE` and `twitter.com/HANDLE` patterns.
  // Username constraints: 1-15 chars, [A-Za-z0-9_].
  // Must be FOLLOWED by a non-username-character (so we don't accidentally
  // capture URLs like `x.com/USERNAME/status/...` where USERNAME ends and a
  // slash begins — actually that's fine, the regex stops at the slash, and
  // the post-check below will drop reserved handles).
  const urlRegex = /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?:[\s"'&/?#]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = urlRegex.exec(html)) !== null) {
    const handle = (m[1] ?? '').toLowerCase();
    if (!handle) continue;
    if (RESERVED_X_HANDLES.has(handle)) continue;
    if (seen.has(handle)) continue;
    seen.add(handle);
    profiles.push({ handle, url: `https://x.com/${handle}` });
  }
  return profiles;
}
