import { z } from 'zod';
import type { BaseSkill, SkillContext } from '../BaseSkill.js';
import { callClaude, CLAUDE_MODEL } from '../runtime/anthropic.js';
import { renderTemplate } from '../runtime/render.js';
import { newSeed } from '../runtime/seed.js';

// ----- Schemas -----
export const CreateLocalBusinessInputSchema = z.object({
  businessType: z
    .string()
    .optional()
    .describe(
      "Type imposé (agence locale, SaaS pour commerçants, service, etc.). Vide → tirage aléatoire.",
    ),
  defaultCity: z
    .string()
    .optional()
    .describe("Ville suggérée pour la prospection (ex: 'Paris'). Default: 'Paris'."),
  languageName: z.string().describe("Langue du pitch — e.g. 'français'."),
});
export type CreateLocalBusinessInput = z.infer<typeof CreateLocalBusinessInputSchema>;

export const LocalBusinessSchema = z.object({
  name: z.string().describe('Nom de marque.'),
  type: z.string().describe('Catégorie: SaaS / agence / service / infoproduit pour commerçants.'),
  pitch: z.string().describe('1 phrase de pitch dans la langue cible.'),
  icp: z.object({
    segment: z
      .string()
      .describe(
        "Métier/business local ULTRA-précis prospectable sur Google Maps (ex: 'salons de coiffure indépendants', 'restaurants traditionnels', 'kinésithérapeutes libéraux', 'mécaniciens auto indé', 'opticiens indé', 'salons de massage').",
      ),
    mapsQuery: z
      .string()
      .describe(
        "Requête de recherche Google Maps optimale pour trouver les prospects (ex: 'salon de coiffure', 'kinésithérapeute', 'mécanicien auto', 'restaurant italien'). Doit matcher ce qu'un utilisateur tape dans Maps.",
      ),
    city: z
      .string()
      .describe(
        "Ville / zone pour démarrer la prospection (ex: 'Paris 11e', 'Lyon centre', 'Bordeaux').",
      ),
    sizeRange: z
      .string()
      .describe("Taille typique du prospect (ex: 'TPE 1-5 employés', 'micro-entrepreneur')."),
    pain: z.string().describe('Le problème concret que le business résout pour cet ICP.'),
    estimatedTicket: z
      .string()
      .describe(
        "Ticket moyen par client (ex: '49€/mois', '500€ setup + 39€/mois', '300€ one-shot').",
      ),
  }),
});
export type LocalBusiness = z.infer<typeof LocalBusinessSchema>;

// ----- Prompt -----
const PROMPT = `# RÔLE
Tu es consultant outbound spécialisé dans la prospection **locale via Google Maps**. Tu ne lances QUE des businesses dont l'ICP est :
- physiquement présent sur Google Maps (pas-de-porte, cabinet, atelier, salon, restaurant…)
- avec un site web typiquement listé sur leur fiche Maps (où on pourra scraper le mail / téléphone)
- ticket réaliste pour TPE/PME locale (typiquement 30-500€/mois ou 300-3000€ one-shot)

# VARIANCE OBLIGATOIRE — process en 2 étapes
Random seed : {{seed}}

**Étape 1.** Liste mentalement 15 métiers locaux prospectables sur Maps :
- coiffeurs, barbiers, salons de massage / spa, instituts de beauté, ongleries, tatoueurs
- restaurants, brasseries, pizzerias, food trucks indé, cafés/coffee shops, bars à vins
- kinésithérapeutes, ostéopathes, dentistes, opticiens, médecins esthétique
- garages auto / mécaniciens, lavages auto, garages moto
- plombiers, électriciens, peintres en bâtiment, paysagistes
- agences immo indé, photographes mariage / portrait, fleuristes
- salles de sport / gyms indé, studios pilates / yoga, MMA / crossfit
- cabinets de notaires, comptables, avocats fiscalistes
- boucheries / poissonneries / cavistes / fromageries de quartier

**Étape 2.** Convertis le seed hex en entier modulo 15 → c'est l'INDEX du métier. **Tu DOIS prendre celui-là, pas l'évidence.** Conçois le business autour de cet ICP.

# CONTRAINTES
- L'ICP doit être PROSPECTABLE via Google Maps → vérifie mentalement "est-ce que je trouve facilement 50 de ces businesses sur Maps avec leur site web ?"
- Le business proposé doit servir CET ICP (logiciel de réservation pour kinés, plateforme de commande pour restos, outil photo pour fleuristes, etc.)
- Évite les business B2B SaaS pur online (Apollo, Salesforce, etc.) — pas prospectable Maps.
- Ticket adapté : un coiffeur indé ne paie pas 500€/mois.

# INPUTS
- Type imposé (peut être vide): {{businessType}}
- Ville par défaut: {{defaultCity}}
- Langue: {{languageName}}

# OUTPUT (JSON strict)
{
  "name": "nom de marque",
  "type": "SaaS pour commerçants | agence locale | service | infoproduit pour pro",
  "pitch": "1 phrase en {{languageName}}",
  "icp": {
    "segment": "métier ULTRA-précis (ex: 'salons de coiffure indépendants')",
    "mapsQuery": "ce qu'on tape dans Maps (ex: 'salon de coiffure')",
    "city": "ville de démarrage (utilise {{defaultCity}} ou plus précise)",
    "sizeRange": "taille typique",
    "pain": "problème concret",
    "estimatedTicket": "ticket"
  }
}
`;

// ----- Skill -----
export class CreateLocalBusinessSkill
  implements BaseSkill<CreateLocalBusinessInput, LocalBusiness>
{
  public readonly name = 'create_local_business';
  public readonly description =
    'Génère une idée business ciblant un métier LOCAL prospectable sur Google Maps (coiffeurs, kinés, restos, mécaniciens…). Output inclut mapsQuery + city prêts pour la grounding.';
  public readonly schema = CreateLocalBusinessInputSchema;

  public readonly displayName = 'Create Local Business';
  public readonly category = 'maps_grounding';
  public readonly order = 1;
  public readonly type = 'llm' as const;
  public readonly model = CLAUDE_MODEL;
  public readonly prompt = PROMPT;

  async execute(
    input: CreateLocalBusinessInput,
    _ctx?: SkillContext,
  ): Promise<LocalBusiness> {
    const seed = newSeed();
    const userMessage = renderTemplate(this.prompt, {
      businessType: input.businessType ?? '',
      defaultCity: input.defaultCity ?? 'Paris',
      languageName: input.languageName,
      seed,
    });
    return callClaude({
      userMessage,
      schema: LocalBusinessSchema,
      effort: 'high',
    });
  }
}
