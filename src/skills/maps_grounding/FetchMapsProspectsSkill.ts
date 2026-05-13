import { z } from 'zod';
import type { BaseSkill, SkillContext } from '../BaseSkill.js';
import {
  fetchMapsProspects,
  DEFAULT_MAPS_MODEL,
  type MapsProspect,
} from '../runtime/gemini-maps.js';

// ----- Schemas -----
export const FetchMapsProspectsInputSchema = z.object({
  mapsQuery: z
    .string()
    .min(2)
    .describe(
      "Requête Google Maps (ex: 'salon de coiffure', 'kinésithérapeute', 'restaurant italien'). Produit par CreateLocalBusinessSkill.",
    ),
  city: z
    .string()
    .min(2)
    .describe("Ville / zone (ex: 'Paris 11e', 'Lyon centre')."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(15)
    .describe('Nombre max de prospects (1-30). Default 15.'),
  latLng: z
    .object({ latitude: z.number(), longitude: z.number() })
    .optional()
    .describe("Coordonnées optionnelles pour préciser la zone."),
});
export type FetchMapsProspectsInput = z.infer<typeof FetchMapsProspectsInputSchema>;

export const MapsProspectSchema = z.object({
  name: z.string(),
  address: z.string().optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
  /** Up to 2 emails scraped from the business website via Gemini urlContext. */
  emails: z.array(z.string()).max(2).optional(),
  rating: z.number().optional(),
  reviewsCount: z.number().optional(),
  googleMapsUri: z.string().optional(),
  placeId: z.string().optional(),
  summary: z.string().optional(),
});

export const FetchMapsProspectsOutputSchema = z.object({
  prospects: z.array(MapsProspectSchema),
  grounded: z.boolean().describe('True si la réponse a effectivement consommé Maps (et a été facturée).'),
  widgetContextToken: z.string().optional(),
});
export type FetchMapsProspectsOutput = z.infer<typeof FetchMapsProspectsOutputSchema>;

// ----- Skill -----
export class FetchMapsProspectsSkill
  implements BaseSkill<FetchMapsProspectsInput, FetchMapsProspectsOutput>
{
  public readonly name = 'fetch_maps_prospects';
  public readonly description =
    'Récupère via Gemini + Maps Grounding les prospects locaux avec site web, puis enrichit chaque site via Gemini urlContext pour extraire jusqu\'à 2 emails de contact.';
  public readonly schema = FetchMapsProspectsInputSchema;

  public readonly displayName = 'Fetch Maps Prospects';
  public readonly category = 'maps_grounding';
  public readonly order = 2;
  public readonly type = 'api' as const;
  public readonly endpoint = `${DEFAULT_MAPS_MODEL} (googleMaps grounding)`;

  async execute(
    input: FetchMapsProspectsInput,
    _ctx?: SkillContext,
  ): Promise<FetchMapsProspectsOutput> {
    const result = await fetchMapsProspects({
      mapsQuery: input.mapsQuery,
      city: input.city,
      limit: input.limit ?? 15,
      latLng: input.latLng,
    });
    return {
      prospects: result.prospects as MapsProspect[],
      grounded: result.grounded,
      widgetContextToken: result.widgetContextToken,
    };
  }
}
