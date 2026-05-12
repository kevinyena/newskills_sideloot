import { z } from 'zod';
import type { BaseSkill, SkillContext } from '../BaseSkill.js';
import { callClaude, CLAUDE_MODEL } from '../runtime/anthropic.js';
import { renderTemplate } from '../runtime/render.js';
import { newSeed } from '../runtime/seed.js';

// ----- Schemas -----
export const PickNewsletterTopicInputSchema = z.object({
  topic: z
    .string()
    .optional()
    .describe(
      "Sujet imposé (ex: 'PSG', 'Formule 1', 'crypto'). Si vide, le modèle choisit librement.",
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
Conçois 1 newsletter à fort potentiel viral et de rétention sur le sujet demandé.

# VARIANCE OBLIGATOIRE — process en 2 étapes
Random seed : {{seed}}

**Étape 1.** Liste mentalement **10 facettes** différentes du sujet (ex pour un club de sport : data/stats, économie & transferts, tactique de jeu, coulisses du vestiaire, formation/jeunes, supporters & culture ultra, médias & presse, histoire & légendes, sponsoring & marketing, finances & gouvernance, équipe féminine, équipe réserve, fans étrangers, jeux vidéo dérivés, etc. — adapte ces facettes à n'importe quel sujet : tech, culture, business, lifestyle).

**Étape 2.** Convertis le seed hex en un nombre entier, modulo 10 → c'est l'INDEX de la facette à choisir dans ta liste. **Tu DOIS prendre celle-là, pas l'évidence.** Construis l'angle éditorial autour d'elle.

Conséquence : pour le même sujet à 2 seeds différents, tu produis 2 angles RADICALEMENT différents (pas juste le même angle avec un nom différent).

# CONTRAINTES DE QUALITÉ
- Le sujet doit être **niche dans la niche**, pas "actu tech" ou "actu sport" trop larges
- L'angle doit être identifiable en 1 phrase
- Le nom doit sonner comme un vrai média indé (style "Snowball", "Generalist", "Sifted", "The Athletic", "Le Vestiaire"...) — pas générique
- L'audience doit être précise (âge, profil, ce qu'elle cherche)

# INPUTS
- Sujet imposé (peut être vide): {{topic}}
- Langue de la newsletter: {{languageName}}

Si le sujet est vide, prends-en un complètement random parmi : sport (PSG, NBA, F1, MotoGP, tennis ATP, NFL, UFC, Premier League, esports CS2, NBA Draft), tech (AI/ML, crypto, hardware Apple, SaaS B2B, fintech, robotique), culture (cinéma indé, séries, rap FR, K-pop, anime, gaming retro, BD), business (VC, immobilier, M&A, marchés financiers, side hustles), lifestyle (gastronomie étoilée, café spé, vélo, running, hiking, vin), société (géopolitique, climat, urbanisme).

# OUTPUT (JSON strict)
{
  "topic": "sujet final retenu (peut affiner le sujet brut)",
  "name": "nom de marque (court, mémorable, type média indé)",
  "audience": "audience cible précise en {{languageName}}",
  "angle": "angle éditorial unique en {{languageName}}, 1 phrase — DOIT être différent à chaque seed",
  "frequency": "quotidienne | hebdomadaire | bi-hebdomadaire | mensuelle"
}
`;

// ----- Skill -----
export class PickNewsletterTopicSkill
  implements BaseSkill<PickNewsletterTopicInput, NewsletterConcept>
{
  public readonly name = 'pick_newsletter_topic';
  public readonly description =
    'Génère un concept de newsletter (sujet, nom, audience, angle, fréquence). Random angle à chaque appel grâce à un seed injecté.';
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
    // Inject a fresh random seed every call. Opus 4.7 removed temperature/top_p,
    // so prompt-level randomness is the only lever for output variance.
    const seed = newSeed();
    const userMessage = renderTemplate(this.prompt, {
      topic: input.topic ?? '',
      languageName: input.languageName,
      seed,
    });
    return callClaude({
      userMessage,
      schema: NewsletterConceptSchema,
      effort: 'high',
    });
  }
}
