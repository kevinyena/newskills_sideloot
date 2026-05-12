import { z } from 'zod';
import type { BaseSkill, SkillContext } from '../BaseSkill.js';
import { callClaude, CLAUDE_MODEL } from '../runtime/anthropic.js';
import { renderTemplate } from '../runtime/render.js';
import { newSeed } from '../runtime/seed.js';

// ----- Schemas -----
export const CreateBusinessIdeaInputSchema = z.object({
  businessType: z
    .string()
    .describe("Type de business — e.g. 'SaaS', 'agence', 'newsletter', 'infoproduct'"),
  languageName: z
    .string()
    .describe("Langue du pitch et de la cible — e.g. 'français', 'anglais'"),
});
export type CreateBusinessIdeaInput = z.infer<typeof CreateBusinessIdeaInputSchema>;

export const BusinessSchema = z.object({
  name: z.string(),
  type: z.string(),
  pitch: z.string(),
  target: z.string(),
});
export type Business = z.infer<typeof BusinessSchema>;

// ----- Prompt -----
const PROMPT = `# RÔLE
Tu es le meilleur CMO du monde, expert reconnu en stratégie marketing et en lancement de business digitaux. Tu as scalé des dizaines de marques DTC, SaaS, agences, infoproducts et newsletters à 8 chiffres. Tu repères les niches porteuses avant tout le monde.

# MISSION
Génère **1 idée de business viable et différenciante** dans la catégorie demandée.

# CONTRAINTES
- Le business doit être réaliste, lançable par une seule personne ou une petite équipe
- Le nom doit sonner comme une vraie marque (pas générique)
- Le pitch doit tenir en 1 phrase tueuse
- La cible doit être précise (pas "tout le monde")
- Évite les idées clichées (yet another AI productivity tool, yet another newsletter sur le SaaS, etc.)

# VARIANCE OBLIGATOIRE
Random seed : {{seed}}

Le seed change à chaque appel. **Pour le même type de business, propose un nom de marque ET un pitch RADICALEMENT DIFFÉRENTS** à chaque seed — change la niche, le ton, l'angle, l'audience. Ne tombe jamais deux fois sur la même idée.

# INPUTS
- Type de business: {{businessType}}
- Langue du pitch & de la cible: {{languageName}}

# OUTPUT (JSON strict, pas de markdown)
{
  "name": "nom de marque",
  "type": "{{businessType}}",
  "pitch": "pitch en 1 phrase dans la langue cible",
  "target": "audience précise dans la langue cible"
}
`;

// ----- Skill -----
export class CreateBusinessIdeaSkill
  implements BaseSkill<CreateBusinessIdeaInput, Business>
{
  public readonly name = 'create_business_idea';
  public readonly description =
    "Génère une idée de business viable et différenciante dans une catégorie donnée (agence, SaaS, newsletter, infoproduct…).";
  public readonly schema = CreateBusinessIdeaInputSchema;

  // ----- UI metadata (ignored by Mintery) -----
  public readonly displayName = 'Create Business Idea';
  public readonly category = 'video_ugc';
  public readonly order = 1;
  public readonly type = 'llm' as const;
  public readonly model = CLAUDE_MODEL;
  public readonly prompt = PROMPT;

  async execute(input: CreateBusinessIdeaInput, _ctx?: SkillContext): Promise<Business> {
    const seed = newSeed();
    const userMessage = renderTemplate(this.prompt, { ...input, seed } as Record<string, unknown>);
    const out = await callClaude({
      userMessage,
      schema: BusinessSchema,
      effort: 'high',
    });
    // Ensure `type` field reflects the requested businessType even if the model echoed differently.
    return { ...out, type: input.businessType };
  }
}
