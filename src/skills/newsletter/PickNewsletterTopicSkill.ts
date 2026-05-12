import { z } from 'zod';
import type { BaseSkill, SkillContext } from '../BaseSkill.js';
import { callClaude, CLAUDE_MODEL } from '../runtime/anthropic.js';
import { renderTemplate } from '../runtime/render.js';

// ----- Schemas -----
export const PickNewsletterTopicInputSchema = z.object({
  topic: z
    .string()
    .optional()
    .describe(
      "Sujet imposé (ex: 'PSG', 'Formule 1', 'crypto'). Si vide → tirage aléatoire.",
    ),
  languageName: z
    .string()
    .describe("Langue de la newsletter — e.g. 'français', 'anglais'."),
});
export type PickNewsletterTopicInput = z.infer<typeof PickNewsletterTopicInputSchema>;

export const NewsletterConceptSchema = z.object({
  topic: z.string().describe('Sujet final retenu (peut être plus précis que celui demandé).'),
  name: z.string().describe('Nom de marque de la newsletter (style vrai média indé).'),
  audience: z.string().describe('Audience cible précise (pas "tout le monde").'),
  angle: z
    .string()
    .describe(
      "L'angle éditorial unique qui la différencie (voix, ton, parti pris, niche dans la niche).",
    ),
  frequency: z
    .enum(['quotidienne', 'hebdomadaire', 'bi-hebdomadaire', 'mensuelle'])
    .describe('Fréquence d\'envoi recommandée.'),
});
export type NewsletterConcept = z.infer<typeof NewsletterConceptSchema>;

// ----- Prompt -----
const PROMPT = `# RÔLE
Tu es éditeur en chef d'un studio de newsletters indépendantes. Tu as lancé une douzaine de newsletters payantes à 6 chiffres (Bilan Sport, Snowball, Generalist, etc. type). Tu sais détecter les niches avec audience passionnée + sous-couverte par les médias mainstream.

# MISSION
Conçois 1 newsletter à fort potentiel viral et de rétention.

# CONTRAINTES
- Le sujet doit être **niche dans la niche**, pas "actu tech" ou "actu sport" qui sont trop larges
- L'angle doit être identifiable en 1 phrase (ex: "la newsletter qui décrypte les transferts du PSG par les chiffres", pas "newsletter sur le PSG")
- Le nom doit sonner comme un vrai média indé (pas générique style "DailyTech")
- L'audience doit être précise (âge, profil, ce qu'elle cherche)

# INPUTS
- Sujet imposé (peut être vide): {{topic}}
- Langue de la newsletter: {{languageName}}

Si le sujet est vide, **tire au hasard** un sujet de cette liste (ou propose équivalent) :
- Sport: PSG, Real Madrid, NBA, NFL, MLB, Formule 1, MotoGP, tennis ATP, UFC, NBA Draft, Premier League, Liga, esports/CSGO, F1 stratégie
- Tech: AI/ML, crypto/web3, hardware Apple, Android, dev outils, SaaS B2B, fintech
- Culture: cinéma indé, séries Netflix, rap FR, K-pop, anime, gaming retro, BD/manga
- Business: VC/startups, immobilier, marchés financiers, M&A, side hustles
- Lifestyle: gastronomie étoilée, vins, café spécialité, vélo, running, hiking
- Société: géopolitique, climat, urbanisme, IA et éthique

# OUTPUT (JSON strict)
{
  "topic": "sujet final retenu (peut affiner le sujet brut)",
  "name": "nom de marque (court, mémorable)",
  "audience": "audience cible précise en {{languageName}}",
  "angle": "angle éditorial unique en {{languageName}}, 1 phrase",
  "frequency": "quotidienne | hebdomadaire | bi-hebdomadaire | mensuelle"
}
`;

// ----- Skill -----
export class PickNewsletterTopicSkill
  implements BaseSkill<PickNewsletterTopicInput, NewsletterConcept>
{
  public readonly name = 'pick_newsletter_topic';
  public readonly description =
    'Génère un concept de newsletter (sujet, nom, audience, angle, fréquence). Aléatoire si aucun sujet fourni.';
  public readonly schema = PickNewsletterTopicInputSchema;

  public readonly displayName = 'Pick Newsletter Topic';
  public readonly category = 'newsletter';
  public readonly order = 1;
  public readonly type = 'llm' as const;
  public readonly model = CLAUDE_MODEL;
  public readonly prompt = PROMPT;

  async execute(
    input: PickNewsletterTopicInput,
    _ctx?: SkillContext,
  ): Promise<NewsletterConcept> {
    const userMessage = renderTemplate(this.prompt, {
      topic: input.topic ?? '',
      languageName: input.languageName,
    });
    return callClaude({
      userMessage,
      schema: NewsletterConceptSchema,
      effort: 'high',
    });
  }
}
