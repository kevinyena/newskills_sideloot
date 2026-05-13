import { z } from 'zod';
import type { BaseSkill, SkillContext } from '../BaseSkill.js';
import { callClaude, CLAUDE_MODEL } from '../runtime/anthropic.js';
import { renderTemplate } from '../runtime/render.js';
import { newSeed } from '../runtime/seed.js';
import { ProspectableBusinessSchema } from './CreateProspectableBusinessSkill.js';

// ----- Schemas -----
export const DefineProspectionStrategyInputSchema = z.object({
  business: ProspectableBusinessSchema.describe(
    'Business + ICP produits par CreateProspectableBusinessSkill.',
  ),
  languageName: z.string().describe("Langue de la stratégie — e.g. 'français'."),
});
export type DefineProspectionStrategyInput = z.infer<
  typeof DefineProspectionStrategyInputSchema
>;

export const ProspectionChannelSchema = z.object({
  name: z
    .string()
    .describe(
      "Nom court du canal (ex: 'LinkedIn outreach', 'Email via business maps', 'Cold call', 'Forums Discord/Slack'…)",
    ),
  percentage: z
    .number()
    .min(0)
    .max(100)
    .describe('Pourcentage d\'effort à allouer (somme totale = 100).'),
  rationale: z
    .string()
    .describe('Pourquoi ce canal pour cet ICP précis (concret, pas générique).'),
  tooling: z
    .string()
    .optional()
    .describe(
      "Outils recommandés (ex: 'Sales Navigator + Lemlist', 'Phantombuster + Hunter.io + Instantly', 'Outscraper Google Maps + Lemlist').",
    ),
  icpFit: z
    .string()
    .describe("Pourquoi cet ICP est accessible via ce canal (visibilité, scrappabilité, etc.)."),
});

export const ProspectionStrategySchema = z.object({
  primaryStrategy: z
    .string()
    .describe('1 paragraphe résumant la stratégie globale dans la langue cible.'),
  channels: z
    .array(ProspectionChannelSchema)
    .min(1)
    .max(5)
    .describe(
      'Mix de canaux (max 5, focus > spread). Somme des percentages = 100. Une chaîne dominante (40-70%).',
    ),
  firstWeek: z
    .string()
    .describe('Plan concret de la 1ère semaine pour démarrer (dans la langue cible).'),
});
export type ProspectionStrategy = z.infer<typeof ProspectionStrategySchema>;

// ----- Prompt -----
const PROMPT = `# RÔLE
Tu es head of growth d'un studio outbound. Tu connais toutes les chaînes de prospection et tu sais EXACTEMENT laquelle marche pour quel type d'ICP. Tu ne fais jamais de "spray and pray" — toujours une chaîne dominante et 1-2 chaînes complémentaires.

# CHAÎNES DE PROSPECTION (référence)
- **LinkedIn outreach** (DMs/InMails ciblés) → bon pour : titres précis (CMO, Head of X), profils tech/cadres avec présence LinkedIn. Inadapté pour : commerçants locaux qui n'ouvrent pas LinkedIn.
- **Email via LinkedIn enrichment** (Sales Navigator → Apollo/Hunter/Lusha → cold email) → bon pour : B2B SaaS/agence avec ICP "titre + secteur + taille". Volume + scaling.
- **Email via business maps** (scraping Google Maps + Outscraper → enrichment téléphone/email → cold) → **LE canal pour business locaux** : coiffeurs, restos, plombiers, kinés, mécaniciens, opticiens, gyms, etc.
- **Cold call** → bon pour : décideurs PME locale, ticket > 1000€, secteurs traditionnels (immo, B2B services).
- **Reddit/Twitter/X DMs** → bon pour : communautés tech, créateurs solo, niches passionnées (gaming, crypto, dev).
- **Forums spécialisés** (Discord/Slack/PMA, fr.indiehackers, etc.) → bon pour : B2B avec audience captive (e-commerce ops, fintech, dev tools).
- **TikTok/Reels paid ads + DMs entrants** → bon pour : B2C, créateurs, ou ICP très jeune.
- **Display retargeting + SEO** → toujours complément, jamais dominant pour 0→100 clients.
- **Partenariats / referrals** → bon pour : ticket premium, services à expertise (consulting, devs senior, design).

# MISSION
Étant donné le business + ICP fournis, propose un **mix de 2 à 4 canaux** dont la **somme = 100%**, avec UNE chaîne dominante (40-70%) et 1-3 chaînes complémentaires.

# VARIANCE
Random seed : {{seed}}
À deux seeds différents pour le même business, **varie l'arbitrage** des canaux secondaires (mais pas le canal dominant si l'ICP est évident — un coiffeur reste prospecté en Google Maps en priorité).

# CONTRAINTES
- Max 4 canaux (focus > spread)
- Somme exacte = 100
- Pas de 25/25/25/25 → toujours une chaîne dominante claire
- **Rationale concrète et spécifique à l'ICP** (pas "LinkedIn marche bien")
- Mentionne les outils précis dans \`tooling\` (Lemlist, Instantly, Outscraper, Sales Navigator, Lusha, Apollo, Phantombuster, etc.)

# INPUT
- Business : {{business}}
- Langue : {{languageName}}

# OUTPUT (JSON strict)
{
  "primaryStrategy": "1 paragraphe synthèse en {{languageName}}",
  "channels": [
    { "name": "...", "percentage": 60, "rationale": "...", "tooling": "...", "icpFit": "..." },
    { "name": "...", "percentage": 30, "rationale": "...", "tooling": "...", "icpFit": "..." },
    { "name": "...", "percentage": 10, "rationale": "...", "icpFit": "..." }
  ],
  "firstWeek": "Plan concret de la 1ère semaine pour démarrer (en {{languageName}})"
}
`;

// ----- Skill -----
export class DefineProspectionStrategySkill
  implements BaseSkill<DefineProspectionStrategyInput, ProspectionStrategy>
{
  public readonly name = 'define_prospection_strategy';
  public readonly description =
    'Définit le mix de canaux de prospection (LinkedIn / business maps / cold call / forums…) avec pourcentages, outils, et plan de 1ère semaine.';
  public readonly schema = DefineProspectionStrategyInputSchema;

  public readonly displayName = 'Define Prospection Strategy';
  public readonly category = 'prospection';
  public readonly order = 2;
  public readonly type = 'llm' as const;
  public readonly model = CLAUDE_MODEL;
  public readonly prompt = PROMPT;

  async execute(
    input: DefineProspectionStrategyInput,
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
    // Defensive: normalize percentages to sum to 100 if Claude drifted slightly.
    return normalizePercentages(out);
  }
}

function normalizePercentages(strategy: ProspectionStrategy): ProspectionStrategy {
  const sum = strategy.channels.reduce((acc, c) => acc + c.percentage, 0);
  if (sum === 0 || sum === 100) return strategy;
  const scaled = strategy.channels.map((c) => ({
    ...c,
    percentage: Math.round((c.percentage / sum) * 100),
  }));
  // Fix rounding drift on the first (dominant) channel.
  const newSum = scaled.reduce((a, c) => a + c.percentage, 0);
  if (scaled.length > 0 && newSum !== 100 && scaled[0]) {
    scaled[0].percentage += 100 - newSum;
  }
  return { ...strategy, channels: scaled };
}
