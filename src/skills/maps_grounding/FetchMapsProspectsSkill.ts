import { z } from 'zod';
import type { BaseSkill, SkillContext } from '../BaseSkill.js';
import {
  fetchProspectsFromApify,
  APIFY_ACTOR_ID,
  type MapsProspect,
} from '../runtime/apify-maps.js';

// ----- Schemas -----
export const FetchMapsProspectsInputSchema = z.object({
  mapsQuery: z
    .string()
    .min(2)
    .describe(
      "Requête Google Maps (ex: 'salon de coiffure', 'kinésithérapeute', 'restaurant italien'). Produit par CreateLocalBusinessSkill.",
    ),
  city: z.string().min(2).describe("Ville / zone (ex: 'Paris 11e', 'Lyon centre')."),
  /** target — what we want at the end (prospects with email). */
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(15)
    .describe('Nombre cible de prospects (1-50). Default 15.'),
  language: z
    .string()
    .min(2)
    .max(5)
    .default('fr')
    .describe("Code langue Maps (default 'fr')."),
});
export type FetchMapsProspectsInput = z.infer<typeof FetchMapsProspectsInputSchema>;

export const ProspectSocialsSchema = z.object({
  instagram: z.array(z.string()).optional(),
  facebook: z.array(z.string()).optional(),
  linkedin: z.array(z.string()).optional(),
  youtube: z.array(z.string()).optional(),
  tiktok: z.array(z.string()).optional(),
  twitter: z.array(z.string()).optional(),
  pinterest: z.array(z.string()).optional(),
});

export const MapsProspectSchema = z.object({
  name: z.string(),
  address: z.string().optional(),
  phone: z.string().optional(),
  phonesFromWebsite: z.array(z.string()).optional(),
  website: z.string().optional(),
  emails: z.array(z.string()).max(2).optional(),
  socials: ProspectSocialsSchema.optional(),
  rating: z.number().optional(),
  reviewsCount: z.number().optional(),
  category: z.string().optional(),
  googleMapsUri: z.string().optional(),
  placeId: z.string().optional(),
  summary: z.string().optional(),
});

export const ApifyStatsSchema = z.object({
  rawCount: z.number().describe('Nb de places retournées par Apify (toutes avec website).'),
  withWebsite: z.number().describe('Nb de prospects avec website confirmé.'),
  withEmails: z.number().describe('Nb de prospects avec au moins 1 email scrapé.'),
  target: z.number().describe("Objectif demandé par l'utilisateur."),
  done: z.boolean().describe('True si target atteint.'),
  costUsdEstimate: z.number().describe('Coût estimé USD (rate card Apify Free/Starter).'),
  costUsdActual: z.number().optional().describe('Coût réel facturé par Apify (run.usageTotalUsd).'),
  actorRunId: z.string().optional().describe("ID du run Apify — visible dans console.apify.com."),
});

export const FetchMapsProspectsOutputSchema = z.object({
  prospects: z.array(MapsProspectSchema),
  stats: ApifyStatsSchema,
});
export type FetchMapsProspectsOutput = z.infer<typeof FetchMapsProspectsOutputSchema>;

// ----- Skill -----
export class FetchMapsProspectsSkill
  implements BaseSkill<FetchMapsProspectsInput, FetchMapsProspectsOutput>
{
  public readonly name = 'fetch_maps_prospects';
  public readonly description =
    'Récupère des prospects locaux via Apify Google Maps Scraper (filtre structurel has-website + Company contacts enrichment qui scrape emails + socials depuis chaque site).';
  public readonly schema = FetchMapsProspectsInputSchema;

  public readonly displayName = 'Fetch Maps Prospects';
  public readonly category = 'maps_grounding';
  public readonly order = 2;
  public readonly type = 'api' as const;
  public readonly endpoint = `apify:${APIFY_ACTOR_ID} (compass/google-maps-scraper)`;

  async execute(
    input: FetchMapsProspectsInput,
    _ctx?: SkillContext,
  ): Promise<FetchMapsProspectsOutput> {
    const result = await fetchProspectsFromApify({
      mapsQuery: input.mapsQuery,
      city: input.city,
      target: input.limit ?? 15,
      language: input.language ?? 'fr',
    });
    return {
      prospects: result.prospects as MapsProspect[],
      stats: result.stats,
    };
  }
}
