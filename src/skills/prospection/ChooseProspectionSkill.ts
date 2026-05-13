import { z } from 'zod';
import type { BaseSkill, SkillContext } from '../BaseSkill.js';
import { callClaude, CLAUDE_MODEL } from '../runtime/anthropic.js';
import { renderTemplate } from '../runtime/render.js';
import { newSeed } from '../runtime/seed.js';
import { ProspectableBusinessSchema } from './CreateProspectableBusinessSkill.js';

// ----- Channel catalog (strict — strategy chooses ONLY among these 3) -----
export const PROSPECTION_CHANNELS = [
  'Email from LinkedIn (via Apify)',
  'X DM reachout',
  'Email via business website (Google Maps data)',
] as const;
export type ProspectionChannelName = (typeof PROSPECTION_CHANNELS)[number];

// ----- Schemas -----
export const ChooseProspectionInputSchema = z.object({
  business: ProspectableBusinessSchema.describe(
    'Business + ICP produits par CreateProspectableBusinessSkill.',
  ),
  languageName: z.string().describe("Langue de la stratégie — e.g. 'français'."),
});
export type ChooseProspectionInput = z.infer<
  typeof ChooseProspectionInputSchema
>;

export const ProspectionChannelSchema = z.object({
  name: z
    .enum(PROSPECTION_CHANNELS)
    .describe('Doit être un des 3 canaux autorisés. Aucun autre nom accepté.'),
  percentage: z
    .number()
    .min(0)
    .max(100)
    .describe('Pourcentage alloué (0 si non pertinent pour cet ICP). Somme totale = 100.'),
  rationale: z
    .string()
    .describe(
      'Pourquoi ce % pour cet ICP précis. Si 0%, dis CONCRÈTEMENT pourquoi le canal ne marche pas.',
    ),
  tooling: z
    .string()
    .optional()
    .describe(
      'Outils précis recommandés pour activer ce canal (ex: Apify actor + Hunter + Lemlist).',
    ),
  icpFit: z
    .string()
    .describe('Pourquoi cet ICP est (ou pas) accessible via ce canal.'),
});

export const ProspectionStrategySchema = z
  .object({
    primaryStrategy: z
      .string()
      .describe('1 paragraphe résumant la stratégie globale dans la langue cible.'),
    channels: z
      .array(ProspectionChannelSchema)
      .length(3)
      .describe(
        'Exactement 3 entrées — une par canal autorisé, dans cet ordre fixe : ' +
          PROSPECTION_CHANNELS.join(' / ') +
          '. Somme des percentages = 100.',
      ),
    firstWeek: z
      .string()
      .describe('Plan concret de la 1ère semaine pour démarrer (dans la langue cible).'),
  })
  .refine(
    (s) => new Set(s.channels.map((c) => c.name)).size === 3,
    { message: 'Chaque canal doit apparaître exactement 1 fois.' },
  );
export type ProspectionStrategy = z.infer<typeof ProspectionStrategySchema>;

// ----- Prompt -----
const PROMPT = `# RÔLE
Tu es head of growth d'un studio outbound. Tu ne fais jamais de "spray and pray" — tu arbitres entre **3 canaux UNIQUEMENT** en fonction de l'ICP. Tu sais lequel marche pour quel ICP, et tu n'as pas peur de mettre 0% sur un canal qui ne fitte pas.

# CANAUX AUTORISÉS (UNIQUEMENT CES 3, AUCUN AUTRE)

## 1. Email from LinkedIn (via Apify)
**Comment** : Apify actor de scraping LinkedIn (filtre par titre + secteur + taille + géo) → export CSV des profils → enrichissement email via Hunter.io / Apollo / Dropcontact / Lusha → cold email via Lemlist / Instantly / Smartlead.
**Marche pour** : ICP B2B avec **titre de poste précis** présent sur LinkedIn (CMO de SaaS, Head of Sales en série B, founder DTC, agency owner, RH Manager PME…). Volume scalable (500-2000 contacts/semaine).
**Ne marche pas pour** : commerçants locaux qui ne sont pas sur LinkedIn (coiffeurs, restos, mécaniciens…). Créateurs/founders très early qui mettent leur côté pro sur X plutôt que LinkedIn.

## 2. X DM reachout
**Comment** : Recherche X par bio/keyword + filtres followers/engagement → DM personnalisé manuel ou semi-auto (Tweet Hunter, TypeFully) → relances limitées (X bride les DMs > 3-4/jour pour comptes sans Premium).
**Marche pour** : **créateurs solo, indie hackers, founders early-stage, profils tech / dev / crypto / IA actifs sur X**. Audience qui répond elle-même (pas d'assistant). Ticket plutôt bas mais conversion DM>email pour ces profils.
**Ne marche pas pour** : décideurs corporate (rarement sur X). Commerçants locaux. Volume faible vs email/LinkedIn.

## 3. Email via business website (Google Maps data)
**Comment** : Outscraper / Phantombuster → scraping Google Maps (requête métier + ville → liste de business avec site web + tel) → crawl du site (Hunter Email Finder, Apify website-content-crawler) pour extraire l'email contact / gérant → cold email via Lemlist / Instantly.
**Marche pour** : **business locaux/physiques avec site web** (coiffeurs, restos, gyms, kinés, plombiers, mécaniciens, opticiens, dentistes, agences immo, magasins indé, hôtels). Le gérant lit son email "contact@".
**Ne marche pas pour** : SaaS / agences pures en ligne sans présence Maps. Décideurs corporate (l'email contact@ tombe sur un assistant).

# MISSION
Pour le business + ICP fournis, alloue **les % entre EXACTEMENT ces 3 canaux** (dans cet ordre fixe). **Tu DOIS retourner les 3 entrées**, même si l'allocation est 0%.

# RÈGLES D'ARBITRAGE
- ICP = business local avec site (gym, salon, resto…) → canal **3** dominant (60-100%)
- ICP = cadre/décideur B2B avec titre LinkedIn → canal **1** dominant (60-100%)
- ICP = créateur/indie hacker/dev/founder early actif sur X → canal **2** dominant (40-70%), souvent combiné avec canal 1
- Si un canal ne fitte pas du tout → mets 0% et explique POURQUOI dans \`rationale\`
- **Une chaîne doit toujours être clairement dominante** (pas 34/33/33)

# VARIANCE
Random seed : {{seed}}
Le seed influence l'arbitrage des canaux **secondaires** seulement (le dominant reste évident). Varie le mix secondaire entre 2 seeds, pas l'ordre des priorités.

# INPUT
- Business : {{business}}
- Langue : {{languageName}}

# OUTPUT (JSON strict, EXACTEMENT 3 entrées channels dans l'ordre du catalogue)
{
  "primaryStrategy": "1 paragraphe synthèse en {{languageName}}",
  "channels": [
    { "name": "Email from LinkedIn (via Apify)", "percentage": ..., "rationale": "...", "tooling": "...", "icpFit": "..." },
    { "name": "X DM reachout", "percentage": ..., "rationale": "...", "tooling": "...", "icpFit": "..." },
    { "name": "Email via business website (Google Maps data)", "percentage": ..., "rationale": "...", "tooling": "...", "icpFit": "..." }
  ],
  "firstWeek": "Plan concret de la 1ère semaine (en {{languageName}})"
}
`;

// ----- Skill -----
export class ChooseProspectionSkill
  implements BaseSkill<ChooseProspectionInput, ProspectionStrategy>
{
  public readonly name = 'choose_prospection';
  public readonly description =
    'Alloue les % entre 3 canaux figés : email LinkedIn (Apify) / X DM / email via Google Maps. Mix adapté à l\'ICP, somme = 100, peut mettre 0% sur un canal non pertinent.';
  public readonly schema = ChooseProspectionInputSchema;

  public readonly displayName = 'Choose Prospection';
  public readonly category = 'prospection';
  public readonly order = 2;
  public readonly type = 'llm' as const;
  public readonly model = CLAUDE_MODEL;
  public readonly prompt = PROMPT;

  async execute(
    input: ChooseProspectionInput,
    _ctx?: SkillContext,
  ): Promise<ProspectionStrategy> {
    const seed = newSeed();
    const userMessage = renderTemplate(this.prompt, {
      business: input.business,
      languageName: input.languageName,
      seed,
    });
    const out = await callClaude({
      userMessage,
      schema: ProspectionStrategySchema,
      effort: 'high',
    });
    // Defensive: enforce canonical channel order + normalize percentages to sum to 100.
    return normalize(out);
  }
}

function normalize(strategy: ProspectionStrategy): ProspectionStrategy {
  // Reorder channels to match the canonical catalog order.
  const byName = new Map(strategy.channels.map((c) => [c.name, c] as const));
  const ordered = PROSPECTION_CHANNELS.map((n) => byName.get(n)).filter(
    (c): c is ProspectionStrategy['channels'][number] => Boolean(c),
  );

  // Normalize percentages to sum to 100 (defensive against Claude drift).
  const sum = ordered.reduce((acc, c) => acc + c.percentage, 0);
  let scaled = ordered;
  if (sum > 0 && sum !== 100) {
    scaled = ordered.map((c) => ({
      ...c,
      percentage: Math.round((c.percentage / sum) * 100),
    }));
    const newSum = scaled.reduce((a, c) => a + c.percentage, 0);
    if (newSum !== 100 && scaled.length > 0) {
      // Absorb rounding drift into the largest-percentage channel.
      const idx = scaled.reduce(
        (best, c, i) => (c.percentage > (scaled[best]?.percentage ?? 0) ? i : best),
        0,
      );
      const target = scaled[idx];
      if (target) target.percentage += 100 - newSum;
    }
  }

  return { ...strategy, channels: scaled };
}
