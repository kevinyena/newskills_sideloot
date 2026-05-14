import { z } from 'zod';
import type { BaseSkill, SkillContext } from '../BaseSkill.js';
import { searchRecentTweets, type XSearchAuthor } from '../runtime/x-api.js';

// X "Tweet Read" pricing — $0.010 per resource returned.
const PRICING = {
  tweetReadPerResource: 0.010,
} as const;

// Soft signal: bio mentions DM/open/msg → likely accepts DMs from anyone.
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
  /** Topics that prospects tweet about. Used to build the X search query. */
  topics: z
    .array(z.string())
    .min(1)
    .max(8)
    .describe(
      "Sujets dont parlent les prospects (ex: 'indie hacker', 'micro-SaaS'). 2-5 idéal. Tirés de business.icp.xTopics.",
    ),
  /** Keywords that must appear in the prospect's BIO to qualify. */
  bioKeywords: z
    .array(z.string())
    .min(1)
    .max(15)
    .describe(
      "Keywords filtrés contre la bio (description). Tirés de business.icp.xBioKeywords. Match insensible à la casse.",
    ),
  /** Target number of qualifying prospects. */
  target: z.number().int().min(1).max(50).default(10),
  /** Language filter for tweet search. */
  lang: z.string().min(2).max(5).optional(),
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
  /** Soft signal: bio mentions "DM me", "DMs open", 📩 etc. */
  openDmsHint: z.boolean(),
  /** Quality score 0-100: bio keyword count + open-DM bonus + follower normalizer. */
  score: z.number(),
});
export type XProspect = z.infer<typeof XProspectSchema>;

export const FindXProspectsOutputSchema = z.object({
  prospects: z.array(XProspectSchema),
  query: z.string().describe('Requête X effectivement utilisée (debug).'),
  stats: z.object({
    searchCalls: z.number(),
    tweetsScanned: z.number(),
    uniqueAuthors: z.number(),
    bioMatched: z.number(),
    target: z.number(),
    done: z.boolean(),
    costUsdEstimate: z.number(),
    /** Si non-null, la requête X a échoué — message d'erreur brut pour debug. */
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
    "Cherche sur X des utilisateurs dont la bio matche l'ICP (parmi ceux qui ont tweeté récemment sur les topics). Soft-flag les profils avec hints d'open-DMs (📩, 'DMs open', 'DM me', ...). X pay-as-you-go: $0.010 par tweet retourné.";
  public readonly schema = FindXProspectsInputSchema;

  public readonly displayName = 'Find X Prospects';
  public readonly category = 'x_dm';
  public readonly order = 2;
  public readonly type = 'api' as const;
  public readonly endpoint = 'twitter.com /2/tweets/search/recent';

  async execute(
    input: FindXProspectsInput,
    _ctx?: SkillContext,
  ): Promise<FindXProspectsOutput> {
    const target = input.target ?? 10;

    // Build a tight OR query from topics: covers people TALKING about these
    // things RIGHT NOW (recent search = last 7 days). We'll filter on bio after.
    const topicPart = input.topics
      .map((t) => (t.includes(' ') ? `"${t}"` : t))
      .join(' OR ');
    const query = `(${topicPart}) -is:retweet has:profile_image`;

    // Single search call — 100 tweets returned ≈ 60-90 unique authors after
    // dedupe. Plenty to filter from.
    let searchCalls = 0;
    let tweetsScanned = 0;
    let searchError: string | undefined;
    const allAuthors: XSearchAuthor[] = [];
    try {
      searchCalls++;
      const r = await searchRecentTweets(query, { maxResults: 100, lang: input.lang });
      tweetsScanned = r.tweetsReturned;
      allAuthors.push(...r.authors);
    } catch (e) {
      // Capture the error so the UI can surface it — without this the skill
      // silently returned 0/0/0/0 and the user couldn't tell what went wrong.
      searchError = (e as Error).message;
      // eslint-disable-next-line no-console
      console.error(`[find_x_prospects] X search failed: ${searchError}\nquery: ${query}`);
    }

    // Filter by bio keywords + score
    const matched = allAuthors
      .filter((a) => bioMatchesKeywords(a.bio, input.bioKeywords))
      .map((a) => {
        const lower = (a.bio ?? '').toLowerCase();
        const kwHits = input.bioKeywords.filter((k) => lower.includes(k.toLowerCase())).length;
        const openHint = bioSuggestsOpenDms(a.bio);
        const followersBoost = Math.min(20, Math.log10(Math.max(1, a.followersCount ?? 1)) * 5);
        // 50 base + 10/kw hit + 20 open hint + up to 20 followers
        const score = Math.min(
          100,
          Math.round(50 + kwHits * 10 + (openHint ? 20 : 0) + followersBoost),
        );
        const prospect: XProspect = {
          handle: a.handle,
          userId: a.userId,
          name: a.name,
          bio: a.bio,
          verified: a.verified,
          followersCount: a.followersCount,
          recentTweet: a.recentTweet,
          openDmsHint: openHint,
          score,
        };
        return prospect;
      });

    // Rank: open-DMs hint first (they're more likely to receive), then score desc
    matched.sort((a, b) => {
      if (a.openDmsHint !== b.openDmsHint) return a.openDmsHint ? -1 : 1;
      return b.score - a.score;
    });

    const top = matched.slice(0, target);

    const costUsdEstimate = Number(
      (tweetsScanned * PRICING.tweetReadPerResource).toFixed(4),
    );

    return {
      prospects: top,
      query,
      stats: {
        searchCalls,
        tweetsScanned,
        uniqueAuthors: allAuthors.length,
        bioMatched: matched.length,
        target,
        done: top.length >= target,
        costUsdEstimate,
        searchError,
      },
    };
  }
}
