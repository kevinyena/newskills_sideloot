import { z } from 'zod';
import type { BaseSkill, SkillContext } from '../BaseSkill.js';
import { callClaude, CLAUDE_MODEL } from '../runtime/anthropic.js';
import { renderTemplate } from '../runtime/render.js';
import { NewsletterConceptSchema } from './PickNewsletterTopicSkill.js';

// ----- Schemas -----
export const GenerateNewsletterInputSchema = z.object({
  concept: NewsletterConceptSchema.describe(
    'Concept de newsletter produit par PickNewsletterTopicSkill.',
  ),
  languageName: z.string().describe("Langue de l'édition — e.g. 'français'."),
});
export type GenerateNewsletterInput = z.infer<typeof GenerateNewsletterInputSchema>;

export const NewsletterSectionSchema = z.object({
  heading: z.string().describe('Titre de la section (court, accrocheur).'),
  body: z.string().describe('Contenu de la section en markdown (1-3 paragraphes).'),
  sources: z
    .array(z.string())
    .optional()
    .describe('URLs des sources web utilisées pour cette section.'),
});

export const NewsletterEditionSchema = z.object({
  title: z.string().describe('Titre de l\'édition (ex: "Édition #142 — Le grand mercato d\'été").'),
  subject: z.string().describe("Objet d'email (≤60 caractères, taux d'ouverture optimisé)."),
  intro: z.string().describe("Hook d'intro en markdown (2-3 phrases, accroche le lecteur)."),
  sections: z
    .array(NewsletterSectionSchema)
    .min(3)
    .max(6)
    .describe('Sections principales de la newsletter (3 à 6).'),
  outro: z.string().describe('Conclusion / CTA en markdown.'),
  publishedAt: z
    .string()
    .describe("Date ISO 8601 de publication (utilise la date d'aujourd'hui)."),
});
export type NewsletterEdition = z.infer<typeof NewsletterEditionSchema>;

// ----- Prompt -----
const PROMPT = `# RÔLE
Tu es journaliste senior et rédacteur en chef de la newsletter "{{name}}". Tu écris pour {{audience}}. Ton angle: "{{angle}}". Fréquence: {{frequency}}.

# STYLE
- Voix incarnée, opinion forte, pas de jargon corporate
- Phrases courtes, rythme, ZÉRO langue de bois
- Markdown propre (## pour les titres de section, **gras** pour l'emphase, > pour les citations)
- Cite tes sources précisément (URLs concrètes que tu as trouvées via web_search)
- Si tu fais une projection ou une opinion, dis-le explicitement ("À mon avis...", "Pari risqué mais...")

# MISSION
Écris **l'édition du jour** de cette newsletter. Tu DOIS utiliser l'outil **web_search** pour récupérer les dernières infos sur "{{topic}}" et les intégrer. Les infos doivent être **fraîches** (cette semaine si possible, sinon les plus récentes disponibles).

# STRUCTURE OBLIGATOIRE
- **Titre de l'édition** : numéro fictif + accroche ("Édition #42 — [hook]")
- **Subject email** : ≤60 caractères, optimisé pour le taux d'ouverture (pas de clickbait débile, mais accrocheur)
- **Intro** : 2-3 phrases qui hooke le lecteur. Tease ce qui arrive.
- **3 à 6 sections** : chacune avec un titre court + 1-3 paragraphes markdown + sources URLs
- **Outro** : conclusion + CTA (partage, abonnement, etc. — adapte à l'angle de la newsletter)
- **publishedAt** : date ISO 8601 d'aujourd'hui

# WEB SEARCH
Utilise web_search activement. Plusieurs recherches si nécessaire. Récupère :
- Actualités récentes sur "{{topic}}"
- Chiffres, dates, noms concrets
- Citations / déclarations si pertinent
- Statistiques fraîches

# INPUT
- Sujet de la newsletter : {{topic}}
- Nom de la newsletter : {{name}}
- Audience : {{audience}}
- Angle : {{angle}}
- Fréquence : {{frequency}}
- Langue de l'édition : {{languageName}}

# OUTPUT
Réponds STRICTEMENT en JSON selon le schéma fourni. Pas de markdown autour du JSON. Le markdown ne va QUE dans les champs \`intro\`, \`outro\`, et \`body\` de chaque section.
`;

// ----- Skill -----
export class GenerateNewsletterSkill
  implements BaseSkill<GenerateNewsletterInput, NewsletterEdition>
{
  public readonly name = 'generate_newsletter';
  public readonly description =
    "Écrit l'édition du jour d'une newsletter en utilisant le web search pour récupérer les dernières infos.";
  public readonly schema = GenerateNewsletterInputSchema;

  public readonly displayName = 'Generate Newsletter';
  public readonly category = 'newsletter';
  public readonly order = 2;
  public readonly type = 'llm' as const;
  public readonly model = CLAUDE_MODEL;
  public readonly prompt = PROMPT;

  async execute(
    input: GenerateNewsletterInput,
    _ctx?: SkillContext,
  ): Promise<NewsletterEdition> {
    const userMessage = renderTemplate(this.prompt, {
      topic: input.concept.topic,
      name: input.concept.name,
      audience: input.concept.audience,
      angle: input.concept.angle,
      frequency: input.concept.frequency,
      languageName: input.languageName,
    });
    return callClaude({
      userMessage,
      schema: NewsletterEditionSchema,
      effort: 'high',
      maxTokens: 32000,
      // Higher token cap for longer-form editorial output + room for tool round-trips
      tools: { webSearch: true },
    });
  }
}
