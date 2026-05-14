import { z } from 'zod';
import type { BaseSkill, SkillContext } from '../BaseSkill.js';
import { searchGoogleForXProfiles } from '../runtime/google-search.js';
import { lookupUsersByUsernames } from '../runtime/x-api.js';

// X "User Read" cost per resource — billed per user returned by /2/users/by.
const X_USER_READ_PER_RESOURCE = 0.010;

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

function bioMatchesKeywords(bio: string | undefined, keywords: string[]): boolean {
  if (!bio) return false;
  const lower = bio.toLowerCase();
  return keywords.some((k) => lower.includes(k.toLowerCase()));
}
function bioSuggestsOpenDms(bio: string | undefined): boolean {
  if (!bio) return false;
  return OPEN_DM_HINTS.some((re) => re.test(bio));
}

// ----- Schemas -----
export const FindXProspectsInputSchema = z.object({
  /** Keywords used in the Google query AND to filter the returned bios. */
  bioKeywords: z
    .array(z.string())
    .min(1)
    .max(15)
    .describe(
      "Mots-clés cherchés dans les bios via Google. Query: (site:x.com OR site:twitter.com) (\"kw1\" OR ...) -inurl:status -inurl:search",
    ),
  /** Optional extra terms — folded into the Google query along with bio keywords. */
  topics: z
    .array(z.string())
    .max(8)
    .optional()
    .describe(
      "Optionnel — termes additionnels OU-és dans la query Google. Non utilisés pour le filtre bio post-fetch.",
    ),
  /** Target number of qualifying prospects. */
  target: z.number().int().min(1).max(50).default(10),
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

export const FindXProspectsOutputSchema = z.object({
  prospects: z.array(XProspectSchema),
  query: z.string().describe("Requête Google utilisée (debug)."),
  stats: z.object({
    googleHandlesFound: z
      .number()
      .describe("Nb de handles X uniques extraits du SERP Google."),
    xLookupCalls: z
      .number()
      .describe("Nb d'utilisateurs cherchés via X API /users/by."),
    bioMatched: z
      .number()
      .describe("Nb de bios qui contiennent au moins 1 keyword (vérification post-lookup)."),
    target: z.number(),
    done: z.boolean(),
    costUsdEstimate: z
      .number()
      .describe("Coût estimé en USD (Google gratuit + X user lookup à $0.010/user)."),
    searchError: z.string().optional(),
  }),
});
export type FindXProspectsOutput = z.infer<typeof FindXProspectsOutputSchema>;

// ----- Skill -----
export class FindXProspectsSkill
  implements BaseSkill<FindXProspectsInput, FindXProspectsOutput>
{
  public readonly name = 'find_x_prospects';
  public readonly description =
    "Cherche sur Google des profils X dont la PAGE contient les keywords (typiquement = leur bio), puis vérifie/enrichit chaque handle via l'API X (/2/users/by). Soft-flag les bios avec hints d'open DMs.";
  public readonly schema = FindXProspectsInputSchema;

  public readonly displayName = 'Find X Prospects';
  public readonly category = 'x_dm';
  public readonly order = 2;
  public readonly type = 'api' as const;
  public readonly endpoint = 'google.com/search → twitter.com /2/users/by';

  async execute(
    input: FindXProspectsInput,
    _ctx?: SkillContext,
  ): Promise<FindXProspectsOutput> {
    const target = input.target ?? 10;

    // Build the query keyword list. bioKeywords first (primary), topics next.
    const seenLower = new Set<string>();
    const keywords: string[] = [];
    for (const term of [...input.bioKeywords, ...(input.topics ?? [])]) {
      const trimmed = term.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seenLower.has(key)) continue;
      seenLower.add(key);
      keywords.push(trimmed);
    }

    if (keywords.length === 0) {
      return {
        prospects: [],
        query: '',
        stats: {
          googleHandlesFound: 0,
          xLookupCalls: 0,
          bioMatched: 0,
          target,
          done: false,
          costUsdEstimate: 0,
          searchError: 'Aucun keyword fourni — rien à chercher.',
        },
      };
    }

    // Cap to keep the Google query short + well-formed
    const cappedKeywords = keywords.slice(0, 8);

    // ---- 1. Google search → list of handles
    let googleHandles: string[] = [];
    let googleQuery = '';
    let searchError: string | undefined;
    try {
      const r = await searchGoogleForXProfiles({
        keywords: cappedKeywords,
        num: 50, // Google often caps to ~10-30 actual results, but we ask high
      });
      googleQuery = r.query;
      googleHandles = r.profiles.map((p) => p.handle);
    } catch (e) {
      searchError = (e as Error).message;
      // eslint-disable-next-line no-console
      console.error(`[find_x_prospects] Google failed: ${searchError}`);
      return {
        prospects: [],
        query: googleQuery,
        stats: {
          googleHandlesFound: 0,
          xLookupCalls: 0,
          bioMatched: 0,
          target,
          done: false,
          costUsdEstimate: 0,
          searchError,
        },
      };
    }

    if (googleHandles.length === 0) {
      return {
        prospects: [],
        query: googleQuery,
        stats: {
          googleHandlesFound: 0,
          xLookupCalls: 0,
          bioMatched: 0,
          target,
          done: false,
          costUsdEstimate: 0,
          searchError:
            "Google a retourné 0 profil X. Élargis tes keywords ou retire le filtre topic.",
        },
      };
    }

    // ---- 2. Batched X lookup to get real bios + follower counts.
    // /2/users/by accepts up to 100 handles per call. We over-fetch from Google
    // so we may have more than we need — keep the ones with bio match.
    const handlesToLookup = googleHandles.slice(0, Math.max(target * 4, 50));
    let userDetails: Awaited<ReturnType<typeof lookupUsersByUsernames>> = [];
    let lookupError: string | undefined;
    try {
      userDetails = await lookupUsersByUsernames(handlesToLookup);
    } catch (e) {
      lookupError = (e as Error).message;
      // eslint-disable-next-line no-console
      console.error(`[find_x_prospects] X lookup failed: ${lookupError}`);
    }
    const xLookupCalls = handlesToLookup.length;
    const lookupCostUsd = userDetails.length * X_USER_READ_PER_RESOURCE;

    // ---- 3. Filter by bio match (case-insensitive contains any keyword)
    const bioMatchedUsers = userDetails.filter((u) =>
      bioMatchesKeywords(u.bio, input.bioKeywords),
    );

    // ---- 4. Score + sort
    const scored: XProspect[] = bioMatchedUsers.map((u) => {
      const bio = u.bio ?? '';
      const lower = bio.toLowerCase();
      const kwHits = input.bioKeywords.filter((k) => lower.includes(k.toLowerCase())).length;
      const openHint = bioSuggestsOpenDms(bio);
      const followersBoost = Math.min(20, Math.log10(Math.max(1, u.followersCount ?? 1)) * 5);
      const score = Math.min(
        100,
        Math.round(50 + kwHits * 10 + (openHint ? 20 : 0) + followersBoost),
      );
      return {
        handle: u.username,
        userId: u.id,
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
    const costUsdEstimate = Number(lookupCostUsd.toFixed(4));

    return {
      prospects: top,
      query: googleQuery,
      stats: {
        googleHandlesFound: googleHandles.length,
        xLookupCalls,
        bioMatched: bioMatchedUsers.length,
        target,
        done: top.length >= target,
        costUsdEstimate,
        searchError: lookupError, // surface X lookup error if any
      },
    };
  }
}
