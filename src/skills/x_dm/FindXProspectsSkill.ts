import { z } from 'zod';
import type { BaseSkill, SkillContext } from '../BaseSkill.js';
import {
  searchXUsersByQuery,
  normalizeApifyXUser,
  X_USER_SCRAPER_ACTOR_ID,
} from '../runtime/apify-x.js';

// Soft signal: bio mentions DM/open/msg → more likely to accept DMs from anyone.
const OPEN_DM_HINTS = [
  /\bdm me\b/i,
  /\bdms?\s+open\b/i,
  /\bopen\s+dms?\b/i,
  /\bdm[s']*\s*(welcome|always open)\b/i,
  /\bmsg\s*me\b/i,
  /\bmessage\s*me\b/i,
  /📩|📨|💬/,
];

/**
 * Match if the keyword appears in BIO, HANDLE, or display NAME.
 *
 * Requirement evolution:
 *   v1: bio + name + handle (too loose said the user)
 *   v2: bio only (too strict — @Tradermayne dropped)
 *   v3: bio + handle (still missed "Inner Circle Trader")
 *   v4: bio + handle + name — same scope as X People search itself
 */
function profileMatchesKeywords(
  fields: { bio?: string; handle?: string; name?: string },
  keywords: string[],
): boolean {
  const haystack = [fields.bio, fields.handle, fields.name]
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .join(' ')
    .toLowerCase();
  if (!haystack) return false;
  return keywords.some((k) => haystack.includes(k.toLowerCase()));
}

/**
 * Detect non-Latin scripts that indicate the profile is not English-speaking
 * (Japanese/Chinese/Korean/Arabic/Cyrillic/Thai/etc.). When the user picks
 * "USA" localization, profiles with >25% non-Latin characters in their bio +
 * name get dropped. Mixed bios (e.g. mostly English with a few Japanese
 * characters) still pass — the threshold is on RATIO, not presence.
 *
 * We also keep profiles whose bio is empty but handle is ASCII — those are
 * often US-based with just a punchy display name.
 */
function passesLocationFilter(
  fields: { bio?: string; name?: string; handle?: string },
  preset: 'usa' | 'worldwide',
): boolean {
  if (preset === 'worldwide') return true;
  const text = [fields.bio, fields.name].filter(Boolean).join(' ');
  if (!text) return true; // No bio/name to judge from, give benefit of doubt
  // Match CJK + Hangul + Arabic + Cyrillic + Hebrew + Thai + Devanagari ranges
  const nonLatinRe =
    /[぀-ゟ゠-ヿ一-龯가-힯؀-ۿЀ-ӿ֐-׿฀-๿ऀ-ॿ]/g;
  const nonLatinCount = (text.match(nonLatinRe) ?? []).length;
  if (nonLatinCount === 0) return true;
  // Also count "ASCII-ish" letters (the things people actually write English with)
  const latinRe = /[A-Za-z]/g;
  const latinCount = (text.match(latinRe) ?? []).length;
  const total = nonLatinCount + latinCount;
  if (total === 0) return true;
  // > 25% non-latin ⇒ assume non-English-speaking profile, drop.
  return nonLatinCount / total < 0.25;
}
function bioSuggestsOpenDms(bio: string | undefined): boolean {
  if (!bio) return false;
  return OPEN_DM_HINTS.some((re) => re.test(bio));
}

/**
 * Heuristic to keep ONLY profiles likely to accept DMs from non-followers.
 *
 * X doesn't expose the "Allow message requests from everyone" setting via API,
 * so we can't know for sure upfront. Two signals correlate strongly with it
 * being enabled:
 *   1. Bio explicitly says so ("DM me", "DMs open", 📩, etc.) — green light.
 *   2. Small accounts (≤ 5k followers) tend to keep the default-open setting.
 *      Bigger accounts (>5k, especially >25k) get spammed and lock down.
 *
 * Together these typically convert ~70-90% at the DM step, vs ~20-30% with no
 * filter. The trade-off is fewer total prospects per Apify run.
 */
const OPEN_DM_FOLLOWER_THRESHOLD = 5000;

function looksLikeOpenDms(fields: {
  bio?: string;
  followersCount?: number;
}): boolean {
  if (bioSuggestsOpenDms(fields.bio)) return true;
  const followers = fields.followersCount ?? 0;
  if (followers > 0 && followers <= OPEN_DM_FOLLOWER_THRESHOLD) return true;
  return false;
}

// ----- Schemas -----
export const FindXProspectsInputSchema = z.object({
  bioKeywords: z
    .array(z.string())
    .min(1)
    .max(15)
    .describe(
      "Keywords qui doivent apparaître dans la BIO, le HANDLE ou le NOM du profil X. Aussi utilisés pour construire la requête X People search.",
    ),
  topics: z
    .array(z.string())
    .max(8)
    .optional()
    .describe(
      "Optionnel — élargit la requête X People search (OR-joints avec bioKeywords). Ne sont PAS utilisés pour le filtre bio strict.",
    ),
  target: z.number().int().min(1).max(50).default(10),
  locationPreset: z
    .enum(['usa', 'worldwide'])
    .default('usa')
    .describe(
      "Filtre langue de bio. 'usa' = drop les profils dont la bio est majoritairement non-latine (japonais/chinois/coréen/arabe/etc). 'worldwide' = pas de filtre.",
    ),
  openDmFilter: z
    .enum(['strict', 'off'])
    .default('strict')
    .describe(
      "Filtre 'DMs ouverts'. 'strict' = ne garde QUE les profils avec hint bio (📩, 'DM me'...) ou < 5k followers (probabilité élevée de DMs ouverts). 'off' = pas de filtre, on tente tout le monde.",
    ),
  excludeHandles: z
    .array(z.string())
    .optional()
    .describe(
      "Handles à exclure du résultat (case-insensitive). Sert au top-up loop : on évite de re-retourner des candidats déjà tentés.",
    ),
});
export type FindXProspectsInput = z.infer<typeof FindXProspectsInputSchema>;

export const XProspectSchema = z.object({
  handle: z.string(),
  userId: z.string(),
  name: z.string().optional(),
  bio: z.string().optional(),
  verified: z.boolean().optional(),
  followersCount: z.number().optional(),
  recentTweet: z.string().optional(),
  openDmsHint: z.boolean(),
  score: z.number(),
});
export type XProspect = z.infer<typeof XProspectSchema>;

export const FindXProspectsAttemptSchema = z.object({
  iteration: z.number(),
  terms: z.array(z.string()),
  maxItems: z.number(),
  returned: z.number(),
  bioMatched: z.number(),
  droppedProtected: z.number().describe('Profils privés/protégés (DM impossible) filtrés à cette itération.'),
  droppedNonEnglish: z.number().describe("Profils filtrés par locationPreset (bio non-latine)."),
  droppedClosedDms: z.number().describe("Profils filtrés par openDmFilter (probablement DMs fermés)."),
  costUsdActual: z.number().optional(),
  actorRunId: z.string().optional(),
});

export const FindXProspectsOutputSchema = z.object({
  prospects: z.array(XProspectSchema),
  query: z.string().describe("Requête initiale (keywords joints par ' · ' pour debug)."),
  stats: z.object({
    usersReturned: z.number().describe('Cumul des profils retournés par Apify (toutes itérations).'),
    bioMatched: z.number().describe('Cumul des profils dont la bio, handle ou nom matche au moins 1 keyword (avant filtre privé).'),
    droppedProtected: z.number().describe('Cumul des profils privés filtrés (DM impossible).'),
    droppedNonEnglish: z.number().describe('Cumul des profils filtrés par locationPreset.'),
    droppedClosedDms: z.number().describe('Cumul des profils filtrés par openDmFilter.'),
    target: z.number(),
    done: z.boolean(),
    iterations: z.number().describe("Nombre d'appels Apify déclenchés pour atteindre target."),
    attempts: z.array(FindXProspectsAttemptSchema).describe('Détail par itération : query/coût/résultats.'),
    costUsdActual: z.number().optional().describe('Coût RÉEL CUMULÉ sur toutes les itérations.'),
    actorRunIds: z.array(z.string()).describe('Tous les run IDs Apify déclenchés.'),
    searchError: z.string().optional(),
  }),
});
export type FindXProspectsOutput = z.infer<typeof FindXProspectsOutputSchema>;

// ----- Skill -----

/**
 * Iteration plan:
 *   iter 0   → all bioKeywords + topics OR-joined (one big X People search)
 *   iter 1+  → one bioKeyword at a time (cycles through bioKeywords to surface
 *              different people the OR-query may have missed at the tail end)
 *
 * We stop as soon as `collected.size >= target` or we run out of keywords to
 * try. Hard ceiling of 10 iterations per call to bound cost (~$0.16 max).
 */
const ITERATION_HARD_CEILING = 10;

export class FindXProspectsSkill
  implements BaseSkill<FindXProspectsInput, FindXProspectsOutput>
{
  public readonly name = 'find_x_prospects';
  public readonly description =
    "Cherche des profils X dont la bio, le handle ou le nom contient au moins 1 keyword via Apify (apidojo/twitter-user-scraper). Itère jusqu'à atteindre target. Soft-flag les bios avec hints d'open DMs.";
  public readonly schema = FindXProspectsInputSchema;

  public readonly displayName = 'Find X Prospects';
  public readonly category = 'x_dm';
  public readonly order = 2;
  public readonly type = 'api' as const;
  public readonly endpoint = `apify:${X_USER_SCRAPER_ACTOR_ID}`;

  async execute(
    input: FindXProspectsInput,
    _ctx?: SkillContext,
  ): Promise<FindXProspectsOutput> {
    const target = input.target ?? 10;

    // Merge bioKeywords + topics (dedupe), kept for the iter-0 OR query.
    const seenLower = new Set<string>();
    const initialTerms: string[] = [];
    for (const term of [...input.bioKeywords, ...(input.topics ?? [])]) {
      const trimmed = term.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seenLower.has(key)) continue;
      seenLower.add(key);
      initialTerms.push(trimmed);
    }
    if (initialTerms.length === 0) {
      return {
        prospects: [],
        query: '',
        stats: {
          usersReturned: 0,
          bioMatched: 0,
          droppedProtected: 0,
          droppedNonEnglish: 0,
          droppedClosedDms: 0,
          target,
          done: false,
          iterations: 0,
          attempts: [],
          actorRunIds: [],
          searchError: 'Aucun keyword fourni — rien à chercher.',
        },
      };
    }
    // X People search appears to choke (returns 0 results) when given >4-5
    // OR'd terms. Cap iter 0 hard at 4. The remaining keywords still get
    // tested individually in iters 1+, so coverage is preserved.
    const initialSearchTerms = initialTerms.slice(0, 4);
    const query = initialTerms.join(' · ');

    // Accumulators across iterations
    const collected = new Map<string, ReturnType<typeof normalizeApifyXUser>>();
    let usersReturnedTotal = 0;
    let bioMatchedTotal = 0;
    let droppedProtectedTotal = 0;
    let droppedNonEnglishTotal = 0;
    let droppedClosedDmsTotal = 0;
    let totalCost = 0;
    const locationPreset = input.locationPreset ?? 'usa';
    const openDmFilter = input.openDmFilter ?? 'strict';
    // Lowercase set of handles to exclude from results (top-up loop).
    const excludeLower = new Set(
      (input.excludeHandles ?? []).map((h) => h.replace(/^@/, '').toLowerCase()),
    );
    const runIds: string[] = [];
    const attempts: z.infer<typeof FindXProspectsAttemptSchema>[] = [];
    /** Set ONLY on a hard Apify failure (fetch throw, demo stubs, etc.). Not on
     *  informational "Your run has finished" status messages with 0 results,
     *  which were previously short-circuiting all subsequent iterations. */
    let hardError: string | undefined;
    /** Most recent non-empty statusMessage from Apify across iterations. Used
     *  as a fallback hint when ALL iterations come up empty. */
    let lastStatusMessage: string | undefined;

    const runIteration = async (
      iteration: number,
      queryTerms: string[],
      maxItems: number,
    ): Promise<void> => {
      let res;
      try {
        res = await searchXUsersByQuery({ searchTerms: queryTerms, maxItems });
      } catch (e) {
        // Hard fail — fetch threw. Stop the loop because this is likely a
        // token/network issue that won't fix itself on retry.
        hardError = (e as Error).message;
        // eslint-disable-next-line no-console
        console.error(
          `[find_x_prospects] iter ${iteration} Apify FAILED hard: ${hardError}\nterms: ${queryTerms.join(',')}`,
        );
        attempts.push({
          iteration,
          terms: queryTerms,
          maxItems,
          returned: 0,
          bioMatched: 0,
          droppedProtected: 0,
          droppedNonEnglish: 0,
          droppedClosedDms: 0,
        });
        return;
      }
      // Apify finished but returned no users — common when X People search
      // has nothing for the query. DO NOT treat as a hard error: subsequent
      // iterations with different keywords may still succeed. Just track the
      // status message for diagnostic display at the end.
      if (res.statusMessage) {
        lastStatusMessage = res.statusMessage;
        // eslint-disable-next-line no-console
        console.log(
          `[find_x_prospects] iter ${iteration} returned ${res.users.length} users with statusMessage="${res.statusMessage}"`,
        );
      }
      if (typeof res.costUsdActual === 'number') totalCost += res.costUsdActual;
      runIds.push(res.runId);
      usersReturnedTotal += res.users.length;

      // Normalize + dedupe within this run
      const seenHandles = new Set<string>();
      const normalized = res.users
        .map(normalizeApifyXUser)
        .filter(
          (u): u is NonNullable<ReturnType<typeof normalizeApifyXUser>> => u !== null,
        )
        .filter((u) => {
          const k = u.handle.toLowerCase();
          if (seenHandles.has(k)) return false;
          seenHandles.add(k);
          return true;
        });

      // Keyword must appear in BIO, HANDLE, or display NAME.
      const matched = normalized.filter((u) =>
        profileMatchesKeywords(
          { bio: u.bio, handle: u.handle, name: u.name },
          input.bioKeywords,
        ),
      );
      bioMatchedTotal += matched.length;

      // Drop private/protected accounts upfront — DMs from non-followers fail.
      // If the scraper exposes an explicit canDm=false flag, drop too.
      const dmable = matched.filter((u) => {
        if (u.isProtected) return false;
        if (u.canDm === false) return false;
        return true;
      });
      const droppedProtectedThisIter = matched.length - dmable.length;
      droppedProtectedTotal += droppedProtectedThisIter;

      // Apply localization filter: drop majority-non-latin bios when 'usa'.
      const localized = dmable.filter((u) =>
        passesLocationFilter({ bio: u.bio, name: u.name, handle: u.handle }, locationPreset),
      );
      const droppedNonEnglishThisIter = dmable.length - localized.length;
      droppedNonEnglishTotal += droppedNonEnglishThisIter;

      // Apply "open DMs" filter: keep only profiles likely to accept DMs from
      // strangers. Drops the 70% of profiles whose default-closed DM settings
      // would 403 us at send time.
      const openDmReady =
        openDmFilter === 'strict'
          ? localized.filter((u) =>
              looksLikeOpenDms({ bio: u.bio, followersCount: u.followersCount }),
            )
          : localized;
      const droppedClosedDmsThisIter = localized.length - openDmReady.length;
      droppedClosedDmsTotal += droppedClosedDmsThisIter;

      // Merge into cross-iteration collection (dedupe by handle + skip excluded).
      for (const u of openDmReady) {
        const k = u.handle.toLowerCase();
        if (excludeLower.has(k)) continue; // already tried in a previous round
        if (!collected.has(k)) collected.set(k, u);
      }

      attempts.push({
        iteration,
        terms: queryTerms,
        maxItems,
        returned: res.users.length,
        bioMatched: matched.length,
        droppedProtected: droppedProtectedThisIter,
        droppedNonEnglish: droppedNonEnglishThisIter,
        droppedClosedDms: droppedClosedDmsThisIter,
        costUsdActual: res.costUsdActual,
        actorRunId: res.runId,
      });
    };

    // Batch size: 50 per Apify call (user requirement).
    // X People search rarely surfaces more than ~50 unique relevant profiles
    // per query anyway, so bigger maxItems just wastes Apify credits.
    const BATCH_SIZE = 50;

    // ----- Iteration 0 : single big OR query -----
    await runIteration(0, initialSearchTerms, BATCH_SIZE);

    // ----- Iterations 1..N : one bioKeyword at a time -----
    // Strategy: each individual keyword query surfaces different X People
    // search results than the big OR query (X ranks differently for short
    // queries), so we recover prospects the first run missed.
    //
    // Cap = 1 (iter 0) + every individual keyword, but no more than the hard
    // ceiling (10) to bound cost.
    const dynamicCap = Math.min(ITERATION_HARD_CEILING, 1 + input.bioKeywords.length);
    let iter = 1;
    let kwIdx = 0;
    while (
      !hardError &&
      collected.size < target &&
      iter < dynamicCap &&
      kwIdx < input.bioKeywords.length
    ) {
      const kw = input.bioKeywords[kwIdx++];
      if (!kw) break;
      // Skip if iter 0 already used this exact keyword alone (single-keyword case)
      if (input.bioKeywords.length === 1 && initialSearchTerms.length === 1) break;

      await runIteration(iter, [kw], BATCH_SIZE);
      iter++;
    }

    // Final scoring on the collected unique set
    const scored: XProspect[] = Array.from(collected.values())
      .filter((u): u is NonNullable<typeof u> => u !== null)
      .map((u) => {
        const bio = u.bio ?? '';
        // Count hits across bio + handle + name (mirrors the filter scope above).
        const haystack = [bio, u.handle, u.name]
          .filter((s): s is string => typeof s === 'string' && s.length > 0)
          .join(' ')
          .toLowerCase();
        const kwHits = input.bioKeywords.filter((k) =>
          haystack.includes(k.toLowerCase()),
        ).length;
        const openHint = bioSuggestsOpenDms(bio);
        const followersBoost = Math.min(
          20,
          Math.log10(Math.max(1, u.followersCount ?? 1)) * 5,
        );
        const score = Math.min(
          100,
          Math.round(50 + kwHits * 10 + (openHint ? 20 : 0) + followersBoost),
        );
        return {
          handle: u.handle,
          userId: u.userId,
          name: u.name,
          bio,
          verified: u.verified,
          followersCount: u.followersCount,
          recentTweet: undefined,
          openDmsHint: openHint,
          score,
        };
      });

    // Rank: open-DMs hint first, then score desc
    scored.sort((a, b) => {
      if (a.openDmsHint !== b.openDmsHint) return a.openDmsHint ? -1 : 1;
      return b.score - a.score;
    });

    const top = scored.slice(0, target);
    const done = top.length >= target;

    // Build the final searchError display string:
    //   1. Hard Apify failure (fetch throw / demo stubs) wins
    //   2. If 0 prospects found AND Apify gave a status message, show it
    //   3. If under target but >0 prospects, friendly "elargis tes keywords" hint
    //   4. Otherwise no error
    let searchError: string | undefined;
    if (hardError) {
      searchError = hardError;
    } else if (top.length === 0 && lastStatusMessage) {
      searchError = `Apify: ${lastStatusMessage}`;
    } else if (!done && top.length < target) {
      const protectedHint = droppedProtectedTotal > 0
        ? ` (${droppedProtectedTotal} profils privés filtrés)`
        : '';
      searchError = `Cherché sur ${iter} itération(s), trouvé ${top.length}/${target} profils DM-ables${protectedHint}. Élargis tes keywords (synonymes) ou ajoute des variations.`;
    }

    return {
      prospects: top,
      query,
      stats: {
        usersReturned: usersReturnedTotal,
        bioMatched: bioMatchedTotal,
        droppedProtected: droppedProtectedTotal,
        droppedNonEnglish: droppedNonEnglishTotal,
        droppedClosedDms: droppedClosedDmsTotal,
        target,
        done,
        iterations: iter,
        attempts,
        costUsdActual: totalCost > 0 ? totalCost : undefined,
        actorRunIds: runIds,
        searchError,
      },
    };
  }
}
