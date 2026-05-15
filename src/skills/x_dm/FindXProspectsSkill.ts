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
  bioKeywords: z
    .array(z.string())
    .min(1)
    .max(15)
    .describe(
      "Keywords passés à apidojo/twitter-user-scraper via `searchTerms`. L'actor matche bio/nom/description. On re-filtre les bios post-fetch pour précision.",
    ),
  topics: z
    .array(z.string())
    .max(8)
    .optional()
    .describe("Optionnel — termes additionnels mergés dans searchTerms."),
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
  query: z.string().describe("searchTerms utilisés (joints par ' · ' pour debug)."),
  stats: z.object({
    usersReturned: z.number().describe('Nb de profils retournés par Apify.'),
    bioMatched: z.number().describe('Nb dont la bio matche au moins 1 keyword.'),
    target: z.number(),
    done: z.boolean(),
    costUsdActual: z.number().optional().describe("Coût réel facturé par Apify (run.usageTotalUsd)."),
    actorRunId: z.string().optional(),
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
    "Cherche des profils X dont la bio/nom/description matche les keywords via Apify (apidojo/twitter-user-scraper, champ searchTerms). Soft-flag les bios avec hints d'open DMs.";
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

    // Merge bioKeywords + topics (dedupe), then send to Apify as searchTerms.
    const seenLower = new Set<string>();
    const terms: string[] = [];
    for (const term of [...input.bioKeywords, ...(input.topics ?? [])]) {
      const trimmed = term.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seenLower.has(key)) continue;
      seenLower.add(key);
      terms.push(trimmed);
    }
    if (terms.length === 0) {
      return {
        prospects: [],
        query: '',
        stats: {
          usersReturned: 0,
          bioMatched: 0,
          target,
          done: false,
          searchError: 'Aucun keyword fourni — rien à chercher.',
        },
      };
    }
    // Cap to keep run focused. Actor accepts an array — no operator soup.
    const searchTerms = terms.slice(0, 8);
    const query = searchTerms.join(' · '); // display string for UI

    // Over-fetch: returns may include some bio mismatches we'll filter out.
    const maxItems = Math.min(60, Math.max(target * 2, 20));

    let users;
    let costUsdActual: number | undefined;
    let actorRunId: string | undefined;
    let statusMessage: string | undefined;
    let searchError: string | undefined;
    try {
      const res = await searchXUsersByQuery({ searchTerms, maxItems });
      users = res.users;
      costUsdActual = res.costUsdActual;
      actorRunId = res.runId;
      statusMessage = res.statusMessage;
    } catch (e) {
      searchError = (e as Error).message;
      // eslint-disable-next-line no-console
      console.error(`[find_x_prospects] Apify failed: ${searchError}\nterms: ${searchTerms.join(',')}`);
      return {
        prospects: [],
        query,
        stats: {
          usersReturned: 0,
          bioMatched: 0,
          target,
          done: false,
          searchError,
        },
      };
    }

    // Apify actors sometimes "SUCCEED" silently with 0 items (e.g. Free Plan
    // returns `{demo: true}` stubs). Whenever the wrapper hands us a
    // statusMessage alongside 0 users, surface it as a hard error — the UI
    // shows "0 prospects" otherwise with no clue why.
    if (users.length === 0 && statusMessage) {
      searchError = statusMessage;
    }

    // Normalize + dedupe by handle
    const seenHandles = new Set<string>();
    const normalized = users
      .map(normalizeApifyXUser)
      .filter((u): u is NonNullable<ReturnType<typeof normalizeApifyXUser>> => u !== null)
      .filter((u) => {
        const key = u.handle.toLowerCase();
        if (seenHandles.has(key)) return false;
        seenHandles.add(key);
        return true;
      });

    // Defense in depth: re-check bio match server-side. Apify's keyword
    // search matches bio/name/description — we only want bio matches for
    // precision. Drop any result where the keyword is only in the name.
    const matched = normalized.filter((u) => bioMatchesKeywords(u.bio, input.bioKeywords));

    // Score
    const scored: XProspect[] = matched.map((u) => {
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

    return {
      prospects: top,
      query,
      stats: {
        usersReturned: normalized.length,
        bioMatched: matched.length,
        target,
        done: top.length >= target,
        costUsdActual,
        actorRunId,
        searchError,
      },
    };
  }
}
