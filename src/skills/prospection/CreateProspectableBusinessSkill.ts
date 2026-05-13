import { z } from 'zod';
import type { BaseSkill, SkillContext } from '../BaseSkill.js';
import { callClaude, CLAUDE_MODEL } from '../runtime/anthropic.js';
import { renderTemplate } from '../runtime/render.js';
import { newSeed } from '../runtime/seed.js';

// ----- Schemas -----
export const CreateProspectableBusinessInputSchema = z.object({
  businessType: z
    .string()
    .optional()
    .describe(
      "Type imposé (SaaS, agence, infoproduct, service local, newsletter…). Vide → tirage aléatoire.",
    ),
  languageName: z
    .string()
    .describe("Langue du pitch et de l'ICP — e.g. 'français'."),
});
export type CreateProspectableBusinessInput = z.infer<
  typeof CreateProspectableBusinessInputSchema
>;

export const ProspectableBusinessSchema = z.object({
  name: z.string().describe('Nom de marque (style vrai produit/service).'),
  type: z
    .string()
    .describe('Catégorie: SaaS, agence, infoproduct, service local, newsletter, etc.'),
  pitch: z.string().describe('1 phrase de pitch dans la langue cible.'),
  icp: z.object({
    segment: z
      .string()
      .describe(
        "Segment ULTRA-précis. Soit un type de business local (coiffeurs indé, salons de massage, mécaniciens, restaurants 1 étoile, kinés…) soit un titre+contexte (Head of Sales SaaS PME, CMO DTC scale-up…).",
      ),
    geo: z.string().describe("Zone géographique (ex: 'France', 'EU + US', 'Paris+IDF')."),
    sizeRange: z
      .string()
      .describe(
        "Taille typique du prospect (ex: 'TPE 1-5 employés' ou 'scale-up 50-200 employés').",
      ),
    pain: z.string().describe('Le problème concret que le business résout pour cet ICP.'),
    estimatedTicket: z
      .string()
      .describe(
        "Ticket moyen ou ARR par client (ex: '49€/mois', '5k€ setup + 500€/mois', '2k€ one-shot').",
      ),
  }),
});
export type ProspectableBusiness = z.infer<typeof ProspectableBusinessSchema>;

// ----- Prompt -----
const PROMPT = `# RÔLE
Tu es consultant outbound B2B/local. Tu lances des businesses avec un focus systématique sur "comment trouver mes 100 premiers clients" — pas sur le produit. Tu sais quels businesses sont **prospectables** (ICP identifiable, contact accessible, valeur claire) et quels businesses sont des morts-nés en outbound (audience diluée, B2C aléatoire, etc.).

# VARIANCE OBLIGATOIRE — process en 2 étapes
Random seed : {{seed}}

**Étape 1.** Liste mentalement 20 verticales possibles :
- 10 industries locales prospectables (coiffeurs, restaurants, mécaniciens, kinés, plombiers, électriciens, agences immo, opticiens, dentistes, gyms, etc.)
- 10 verticales SaaS/agence/infoproduct (CMO de SaaS B2B PME, Head of Ops e-commerce, agences de design, RH PME, founders DTC, créateurs solo, podcasters pro, comptables indé, freelances tech, e-commerce shopify >100k€/mois, etc.)

**Étape 2.** Convertis le seed hex en entier modulo 20 → c'est l'INDEX de la verticale à utiliser. **Tu DOIS prendre celle-là, pas l'évidence.** Conçois le business autour de cet ICP.

Conséquence : pour deux seeds différents, tu produis 2 businesses RADICALEMENT différents (pas juste le même avec un nom différent).

# CONTRAINTES
- ICP **identifiable** (liste limitée connue, scrappable ou trouvable sur LinkedIn/Maps)
- Offre avec valeur **quantifiable** (économise X heures, +Y% conv, etc.)
- Ticket réaliste vs. taille de cible (un coiffeur indé ne paie pas 5k€/mois)
- Évite "AI productivity tool", "another no-code platform", etc. — clichés interdits
- Le business doit pouvoir être lancé par 1-3 personnes

# INPUTS
- Type imposé (peut être vide): {{businessType}}
- Langue: {{languageName}}

Si le type est vide, choisis-en un en fonction de la verticale choisie (saas/agence/infoproduct/service local/newsletter/marketplace/coaching).

# OUTPUT (JSON strict)
{
  "name": "nom de marque",
  "type": "SaaS | agence | infoproduct | service local | newsletter | etc.",
  "pitch": "1 phrase dans la langue cible",
  "icp": {
    "segment": "ICP ULTRA-précis (ex: 'coiffeurs indépendants Paris/IDF' ou 'CMO de SaaS B2B série A 50-200 emp')",
    "geo": "zone géographique",
    "sizeRange": "taille typique",
    "pain": "problème concret de l'ICP",
    "estimatedTicket": "ticket ou ARR estimé"
  }
}
`;

// ----- Skill -----
export class CreateProspectableBusinessSkill
  implements BaseSkill<CreateProspectableBusinessInput, ProspectableBusiness>
{
  public readonly name = 'create_prospectable_business';
  public readonly description =
    'Génère une idée business B2B/local avec ICP structuré (segment, taille, geo, pain, ticket) — prête à être prospectée.';
  public readonly schema = CreateProspectableBusinessInputSchema;

  public readonly displayName = 'Create Prospectable Business';
  public readonly category = 'prospection';
  public readonly order = 1;
  public readonly type = 'llm' as const;
  public readonly model = CLAUDE_MODEL;
  public readonly prompt = PROMPT;

  async execute(
    input: CreateProspectableBusinessInput,
    _ctx?: SkillContext,
  ): Promise<ProspectableBusiness> {
    const seed = newSeed();
    const userMessage = renderTemplate(this.prompt, {
      businessType: input.businessType ?? '',
      languageName: input.languageName,
      seed,
    });
    return callClaude({
      userMessage,
      schema: ProspectableBusinessSchema,
      effort: 'high',
    });
  }
}
