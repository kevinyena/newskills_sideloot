import { z } from 'zod';
import type { BaseSkill, SkillContext } from '../BaseSkill.js';
import { callClaude, CLAUDE_MODEL } from '../runtime/anthropic.js';
import { renderTemplate } from '../runtime/render.js';
import { newSeed } from '../runtime/seed.js';

// ----- Schemas -----
export const CreateXOutreachBusinessInputSchema = z.object({
  businessType: z
    .string()
    .optional()
    .describe(
      "Type imposé (SaaS solo, infoproduct, agence solo, newsletter…). Vide → tirage random.",
    ),
  languageName: z
    .string()
    .describe("Langue du pitch et de l'ICP — e.g. 'français'."),
});
export type CreateXOutreachBusinessInput = z.infer<typeof CreateXOutreachBusinessInputSchema>;

export const XOutreachBusinessSchema = z.object({
  name: z.string(),
  type: z.string(),
  pitch: z.string().describe('1 phrase de pitch.'),
  icp: z.object({
    segment: z
      .string()
      .describe(
        "ICP X-active ULTRA-précis (ex: 'indie hackers solo founder MRR <10k', 'builders en public sur AI agents', 'créateurs de cours Notion').",
      ),
    xBioKeywords: z
      .array(z.string())
      .min(5)
      .max(10)
      .describe(
        "6-10 keywords QU'ON RETROUVE LITTÉRALEMENT dans la bio X. Règles strictes: 1-2 mots max chacun, identités/rôles/niches (pas de phrases), tout en minuscules, anglais ou langue de la bio cible. Exemples qui matchent: trader, founder, indie, dev, marketer, designer, dtc, crypto, saas, ai, builder, creator. Exemples qui ne matchent PAS: 'building in public', 'shipping daily', 'AI tinkerer' (trop verbeux).",
      ),
    xTopics: z
      .array(z.string())
      .min(2)
      .describe(
        "Sujets dont ils parlent sur X — peuvent être plus verbeux (ex: 'micro-SaaS', 'no-code', 'bootstrapped', 'AI agents'). Servent à élargir la recherche.",
      ),
    pain: z.string().describe('Le pain concret que le business résout.'),
    estimatedTicket: z.string().describe("Ticket / ARR estimé (ex: '49€/mois', '199$ one-shot')."),
  }),
});
export type XOutreachBusiness = z.infer<typeof XOutreachBusinessSchema>;

// ----- Prompt -----
const PROMPT = `# RÔLE
Tu es growth lead spécialisé dans le **DM outreach sur X (Twitter)** pour vendre à des **créateurs solo et founders early-stage**. Tu ne lances QUE des businesses dont l'ICP :
- est ACTIF sur X (poste régulièrement, a une bio identifiable)
- répond à ses propres DMs (pas d'assistant)
- a une douleur concrète quantifiable

# VARIANCE OBLIGATOIRE — process en 2 étapes
Random seed : {{seed}}

**Étape 1.** Liste 12 ICPs X-actifs prospectables :
indie hackers (MRR<10k), AI builders, no-code makers, Notion/Airtable solopreneurs, créateurs de templates payants, podcasters indé (<5k listeners), newsletter operators (<5k subs), Substack writers, founders en build-in-public, devs freelance saturés, designers indé en SaaS, content creators YT/TikTok early-stage.

**Étape 2.** Convertis le seed hex en entier modulo 12 → c'est l'INDEX. **Prends celui-là, pas l'évidence.** Conçois le business pour cet ICP.

# CONTRAINTES
- Le business doit servir CET ICP — pas un fortune 500
- Évite SaaS B2B mid-market génériques
- Ticket adapté : un indie ne paie pas 999$/mois

# RÈGLES POUR xBioKeywords (CRITIQUE)
- 1-2 mots max par keyword. Pas de phrases.
- Identités/rôles/niches en minuscules. "founder", "trader", "indie", "dtc", "saas" — pas "building in public", "AI tinkerer".
- 6-10 keywords mixant 2-3 LARGES (founder/indie/creator/dev/marketer) + 3-5 NICHE (dtc/saas/crypto/no-code).
- Test mental : x.com/search?q=KEYWORD&f=user retourne-t-il des centaines de profils ? Si non, rejette.

# INPUTS
- Type imposé (peut être vide): {{businessType}}
- Langue: {{languageName}}

# OUTPUT (JSON strict)
{
  "name": "nom de marque",
  "type": "micro-SaaS | infoproduit | agence solo | template payant | newsletter | etc.",
  "pitch": "1 phrase",
  "icp": {
    "segment": "ICP ULTRA-précis",
    "xBioKeywords": ["keyword 1", "keyword 2", ... 5-8 items],
    "xTopics": ["sujet 1", "sujet 2", ... 2-5 items],
    "pain": "douleur concrète",
    "estimatedTicket": "ticket réaliste"
  }
}
`;

// ----- Skill -----
export class CreateXOutreachBusinessSkill
  implements BaseSkill<CreateXOutreachBusinessInput, XOutreachBusiness>
{
  public readonly name = 'create_x_outreach_business';
  public readonly description =
    'Génère une idée business + ICP ciblant des prospects ACTIFS sur X (bio keywords, topics) — prêt pour du DM outreach.';
  public readonly schema = CreateXOutreachBusinessInputSchema;

  public readonly displayName = 'Create X-Outreach Business';
  public readonly category = 'x_dm';
  public readonly order = 1;
  public readonly type = 'llm' as const;
  public readonly model = CLAUDE_MODEL;
  public readonly prompt = PROMPT;

  async execute(
    input: CreateXOutreachBusinessInput,
    _ctx?: SkillContext,
  ): Promise<XOutreachBusiness> {
    const seed = newSeed();
    const userMessage = renderTemplate(this.prompt, {
      businessType: input.businessType ?? '',
      languageName: input.languageName,
      seed,
    });
    return callClaude({
      userMessage,
      schema: XOutreachBusinessSchema,
      // Generating a business idea + ICP keywords does not need deep reasoning.
      // 'high' was making this take 60+s due to adaptive thinking burning cycles
      // re-checking constraints. 'low' is enough — the schema + prompt already
      // enforce all the rules.
      effort: 'low',
    });
  }
}
