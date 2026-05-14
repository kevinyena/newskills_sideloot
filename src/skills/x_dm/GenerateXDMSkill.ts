import { z } from 'zod';
import type { BaseSkill, SkillContext } from '../BaseSkill.js';
import { callClaude, CLAUDE_MODEL } from '../runtime/anthropic.js';
import { renderTemplate } from '../runtime/render.js';
import { newSeed } from '../runtime/seed.js';
import { expandSpintax } from '../runtime/spintax.js';
import { XOutreachBusinessSchema } from './CreateXOutreachBusinessSkill.js';

// ----- Schemas -----
export const GenerateXDMInputSchema = z.object({
  business: XOutreachBusinessSchema.describe('Business + ICP produits par CreateXOutreachBusinessSkill.'),
  languageName: z.string().describe('Langue du DM.'),
  variantCount: z
    .number()
    .int()
    .min(6)
    .max(20)
    .default(6)
    .describe('Nb de variantes à générer après expansion Spintax. Default 6 (minimum demandé).'),
});
export type GenerateXDMInput = z.infer<typeof GenerateXDMInputSchema>;

export const GeneratedXDMSchema = z.object({
  template: z
    .string()
    .min(20)
    .max(2000)
    .describe(
      "Template DM avec spintax {a/b/c}. 4-6 groupes spintax, au moins 3 options chacun. Pas de placeholder {firstName} ici — c'est juste de la variation linguistique.",
    ),
  rationale: z
    .string()
    .describe('Pourquoi ce hook marche pour cet ICP (mécanique psychologique exploitée).'),
  variants: z
    .array(z.string())
    .describe('Variantes uniques générées par expansion du template (post-traitement).'),
  totalCombos: z
    .number()
    .describe('Nb total de combinaisons possibles dans le template.'),
});
export type GeneratedXDM = z.infer<typeof GeneratedXDMSchema>;

// ----- Prompt -----
const PROMPT = `# RÔLE
Tu es expert en DM outreach sur X (Twitter). Tu sais ce qui se fait répondre versus ce qui se fait ghoster ou signaler comme spam :
- ≤ 280 chars (1 DM = 1 idée)
- **Ouverture qui MONTRE qu'on connaît le prospect** (jamais "Hello stranger")
- Pas de ton corporate. Pas de pitch lourd. Pas de calendly dès la 1ère phrase.
- Un "vous" qui ressemble à un humain qui DM un autre humain
- Fin avec une **question** ou une **proposition légère**, pas un CTA agressif

# MISSION
Génère **UN template de DM** en format **Spintax** avec **{option1/option2/option3}** sur les parties les plus variables. Ton code va l'expanser en {{variantCount}}+ variantes uniques.

# CONTRAINTES SPINTAX
- **4 à 6 groupes Spintax** dans le template, **3 à 5 options chacun**
- Le total des combinaisons doit dépasser largement {{variantCount}}
- Les options dans un groupe doivent être **interchangeables sémantiquement**, pas redondantes
- Pas de "{ }" en dehors des groupes Spintax
- N'inclus PAS de placeholder type {firstName} — le DM doit être "généraliste" pour l'ICP, pas personnalisé prospect-par-prospect

# VARIANCE
Random seed : {{seed}}

# INPUTS
- Business : {{business}}
- Langue : {{languageName}}

# EXEMPLE de bon template (anglais, pour calibrer le style — NE PAS COPIER, génère pour {{languageName}}) :
"{Hey/Hi/Yo} — {saw your tweet on/spotted your thread about/noticed you're shipping} {ICP_TOPIC}. {Built/Hacked together} {PRODUCT_DESC} {for solo/for indie/for one-person} {ICP_TYPE}. {No pressure but/Curious if/Wondering if} it'd help — happy to give you a {free 14-day/free month/free trial}."

# OUTPUT (JSON strict)
{
  "template": "le template Spintax complet en {{languageName}}",
  "rationale": "1-2 phrases : pourquoi ce hook marche pour cet ICP",
  "variants": [],
  "totalCombos": 0
}

NOTE: laisse \`variants: []\` et \`totalCombos: 0\` — le code les remplit après expansion.
`;

// ----- Skill -----
export class GenerateXDMSkill implements BaseSkill<GenerateXDMInput, GeneratedXDM> {
  public readonly name = 'generate_x_dm';
  public readonly description =
    'Crée un template de DM X au format Spintax {a/b/c} qui s\'expanse en N (≥6) variantes uniques. Adapté à l\'ICP du business.';
  public readonly schema = GenerateXDMInputSchema;

  public readonly displayName = 'Generate X DM';
  public readonly category = 'x_dm';
  public readonly order = 3;
  public readonly type = 'llm' as const;
  public readonly model = CLAUDE_MODEL;
  public readonly prompt = PROMPT;

  async execute(input: GenerateXDMInput, _ctx?: SkillContext): Promise<GeneratedXDM> {
    const seed = newSeed();
    const target = input.variantCount ?? 6;
    const userMessage = renderTemplate(this.prompt, {
      business: input.business,
      languageName: input.languageName,
      variantCount: target,
      seed,
    });
    const raw = await callClaude({
      userMessage,
      schema: GeneratedXDMSchema,
      effort: 'high',
    });

    // Server-side expansion — Claude can't reliably enumerate the combinations
    // itself, so we always re-derive variants from the template.
    const expansion = expandSpintax(raw.template, target);
    return {
      template: raw.template,
      rationale: raw.rationale,
      variants: expansion.variants,
      totalCombos: expansion.totalCombos,
    };
  }
}
