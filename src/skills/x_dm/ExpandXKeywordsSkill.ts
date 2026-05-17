import { z } from 'zod';
import type { BaseSkill, SkillContext } from '../BaseSkill.js';
import { callClaude, CLAUDE_MODEL } from '../runtime/anthropic.js';
import { renderTemplate } from '../runtime/render.js';
import { newSeed } from '../runtime/seed.js';
import { XOutreachBusinessSchema } from './CreateXOutreachBusinessSkill.js';

// ----- Schemas -----
export const ExpandXKeywordsInputSchema = z.object({
  business: XOutreachBusinessSchema.describe(
    'Business + ICP context — used to keep the new keywords on-niche.',
  ),
  triedKeywords: z
    .array(z.string())
    .describe(
      'Keywords already used in previous Apify searches. The new list MUST avoid these (case-insensitive) AND avoid their close variants.',
    ),
  countNeeded: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(8)
    .describe('How many new keywords to generate. Default 8.'),
  locationPreset: z
    .enum(['usa', 'worldwide'])
    .default('usa')
    .describe(
      "Quand 'usa' : ne propose QUE des keywords en anglais (pas de versions étrangères type 'fondateur', 'gründer'). Quand 'worldwide' : OK de mixer.",
    ),
});
export type ExpandXKeywordsInput = z.infer<typeof ExpandXKeywordsInputSchema>;

export const ExpandedXKeywordsSchema = z.object({
  keywords: z
    .array(z.string())
    .describe(
      'Fresh keywords (1-2 words each, lowercase, identity markers) that target the same ICP from a different angle.',
    ),
  rationale: z
    .string()
    .describe(
      'One short sentence: what angle these new keywords explore vs. the tried ones.',
    ),
});
export type ExpandedXKeywords = z.infer<typeof ExpandedXKeywordsSchema>;

// ----- Prompt -----
const PROMPT = `# ROLE
You generate NEW X (Twitter) bio keywords to expand a prospect search that came up short. The keywords must be words that appear literally in real X bios.

# CONTEXT
The user is searching for prospects matching this business and ICP:
{{business}}

They've already searched with these keywords and didn't hit their target count:
{{triedKeywords}}

# YOUR JOB
Generate {{countNeeded}} NEW keywords that:
1. Target the SAME ICP from a different angle (synonyms, adjacent identities, sub-niches, regional terms, jargon variants).
2. Are 1-2 words MAX each. No phrases. Single nouns/identity markers preferred.
3. Are lowercase.
4. Do NOT overlap or near-duplicate the tried keywords. If they tried "trader", don't return "traders" or "trading".
5. Are words that REAL X bios contain. Test mentally: would x.com/search?q=KEYWORD&f=user return THOUSANDS of profiles? If only hundreds, it's too niche.

# CRITICAL — KEYWORD BREADTH RULE
Your output MUST mix breadth levels:
- AT LEAST 3 BROAD identity keywords that anyone in the loosely-defined niche might write in their bio (e.g. "designer", "engineer", "writer", "investor", "marketer", "founder"). These guarantee non-empty searches.
- AT MOST half of the keywords can be niche-specific (e.g. "dtc", "saas", "etsy", "shopify").
- ZERO obscure tool/platform names that no one writes in their bio. NEVER return "podia", "thinkific", "lemonsqueezy", "penpot", "stan", "circle", "kit" alone — those are tools, not identities. If you want to reference a niche, use the WORK ROLE not the tool name.

If you return only super-niche keywords and the user's search returns 0, you have failed.

# LOCATION TARGETING
Location preset: {{locationPreset}}
- 'usa' → ENGLISH ONLY. Do NOT return French/German/Spanish/Japanese/etc. equivalents of the role. "founder" yes, "fondateur" no.
- 'worldwide' → multilingual variants are fine.

# STRATEGIES TO EXPLORE
- Synonyms in the same language (founder → ceo, owner, builder)
- Adjacent identities (trader → investor, scalper, swing, hedge, analyst)
- Communities/movements (fire, wagmi, buidl, degen, bootstrapped, makers)
- Status markers (ex-google, former, alumni, mentor)
- Niche jargon BUT only if commonly self-applied (dtc, btc, eth, defi, ai, ml)

# VARIANCE
Random seed: {{seed}}

# OUTPUT (strict JSON)
{
  "keywords": ["kw1", "kw2", "..."],
  "rationale": "one sentence on the angle"
}
`;

// ----- Skill -----
export class ExpandXKeywordsSkill
  implements BaseSkill<ExpandXKeywordsInput, ExpandedXKeywords>
{
  public readonly name = 'expand_x_keywords';
  public readonly description =
    "Génère N nouveaux bio keywords X (1-2 mots, identités, lowercase) pour relancer une recherche find_x_prospects qui n'a pas atteint la cible. Évite les keywords déjà essayés.";
  public readonly schema = ExpandXKeywordsInputSchema;

  public readonly displayName = 'Expand X Keywords';
  public readonly category = 'x_dm';
  public readonly order = 5;
  public readonly type = 'llm' as const;
  public readonly model = CLAUDE_MODEL;
  public readonly prompt = PROMPT;

  async execute(input: ExpandXKeywordsInput, _ctx?: SkillContext): Promise<ExpandedXKeywords> {
    const seed = newSeed();
    const userMessage = renderTemplate(this.prompt, {
      business: input.business,
      triedKeywords: input.triedKeywords,
      countNeeded: input.countNeeded ?? 8,
      locationPreset: input.locationPreset ?? 'usa',
      seed,
    });
    const raw = await callClaude({
      userMessage,
      schema: ExpandedXKeywordsSchema,
      effort: 'medium',
    });

    // Server-side hygiene — Claude sometimes:
    //   - returns multi-word "phrases" despite instructions
    //   - returns near-duplicates of tried keywords
    //   - returns the same keyword twice
    // Strip those out post-hoc so the orchestrator never re-tries dead terms.
    const triedLower = new Set(input.triedKeywords.map((k) => k.trim().toLowerCase()));
    const seen = new Set<string>();
    const filtered: string[] = [];
    for (const kw of raw.keywords) {
      const cleaned = kw.trim().toLowerCase().replace(/^[#@]/, '');
      if (!cleaned) continue;
      // Reject phrases > 2 words
      if (cleaned.split(/\s+/).length > 2) continue;
      // Reject exact tried matches
      if (triedLower.has(cleaned)) continue;
      // Reject if it's just a tried keyword with trailing s / variations
      let nearDupe = false;
      for (const tried of triedLower) {
        if (
          cleaned === `${tried}s` ||
          tried === `${cleaned}s` ||
          cleaned === `${tried}ing` ||
          cleaned === `${tried}er`
        ) {
          nearDupe = true;
          break;
        }
      }
      if (nearDupe) continue;
      if (seen.has(cleaned)) continue;
      seen.add(cleaned);
      filtered.push(cleaned);
    }
    return { keywords: filtered, rationale: raw.rationale };
  }
}
