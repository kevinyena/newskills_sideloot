import { z } from 'zod';
import type { BaseSkill, SkillContext } from '../BaseSkill.js';
import { callClaude, CLAUDE_MODEL } from '../runtime/anthropic.js';
import { renderTemplate } from '../runtime/render.js';
import { newSeed } from '../runtime/seed.js';
import { BusinessSchema } from '../video_ugc/CreateBusinessIdeaSkill.js';

// ----- Schemas -----
export const GenerateTikTokCaptionInputSchema = z.object({
  business: BusinessSchema.describe(
    'Business idea produced by create_business_idea (Video UGC pipeline).',
  ),
  videoScript: z
    .string()
    .optional()
    .describe(
      "Optionnel — le script vidéo (ou voiceover) tel que dit dans la vidéo UGC. Aide à écrire une caption qui RACCORDE au contenu visuel/audio.",
    ),
  languageName: z
    .string()
    .default('English')
    .describe("Langue de la caption — default English (TikTok marche mieux en EN)."),
  maxHashtags: z
    .number()
    .int()
    .min(3)
    .max(10)
    .default(5)
    .describe('Nb de hashtags à inclure. Default 5 (sweet spot TikTok).'),
});
export type GenerateTikTokCaptionInput = z.infer<typeof GenerateTikTokCaptionInputSchema>;

export const GeneratedTikTokCaptionSchema = z.object({
  caption: z
    .string()
    .describe(
      "Caption + hashtags prêts à coller. Hashtags fusionnés à la fin. Max 2200 chars (limite TikTok).",
    ),
  captionBody: z.string().describe("Le texte sans les hashtags."),
  hashtags: z.array(z.string()).describe("Liste des hashtags (sans le #)."),
  rationale: z
    .string()
    .describe("1-2 phrases : pourquoi cette caption + ce mix de hashtags marche pour ce business."),
});
export type GeneratedTikTokCaption = z.infer<typeof GeneratedTikTokCaptionSchema>;

// ----- Prompt -----
const PROMPT = `# ROLE
You write TikTok captions that get scroll-stoppers to STAY. You know the algorithm: first 2 seconds matter, captions are read AFTER the video hooks them, hashtags balance broad reach with niche relevance.

# HARD RULES
- NEVER use em dash (—) or en dash (–). Use comma, period, or space.
- NEVER use generic AI-flavored phrases: "Get ready to discover", "Unlock the power of", "Join us as we explore", "Are you tired of?", "Look no further".
- NEVER write the brand name in ALL CAPS in the caption body (looks like 2010 SEO spam).
- NEVER stuff 15+ hashtags. {{maxHashtags}} is the cap.
- Caption body MUST be max 150 characters BEFORE the hashtags. Concise wins on TikTok.
- One emoji max in the body (or zero). TikTok caption emoji-spam looks dated.

# WHAT WORKS ON TIKTOK
- A hook that creates curiosity / makes the viewer want to comment / replay
- A specific outcome or claim ("3 clients in a week", "made $X / week", "saved 2 hours daily")
- A POV or first-person framing ("I built this for", "Watch how I", "this tool just")
- Hashtag stack: 1-2 broad (#fyp #foryou OR niche-broad), 2-3 niche-specific, 1 ultra-specific for the algorithm to pin you
- For software/product: never sell, just SHOW + soft CTA ("link in bio if interested")

# BUSINESS
{{business}}

# VIDEO SCRIPT (use it to match what the viewer just saw/heard)
{{videoScript}}

# OUTPUT (strict JSON, written in {{languageName}})
{
  "caption": "full caption with hashtags merged at the end, single string ready to paste",
  "captionBody": "just the body, no hashtags",
  "hashtags": ["hashtag1", "hashtag2", ...],   // {{maxHashtags}} items, lowercase, no # prefix
  "rationale": "1-2 sentences explaining the hook + hashtag strategy"
}

# VARIANCE
Random seed: {{seed}}
`;

// ----- Skill -----
export class GenerateTikTokCaptionSkill
  implements BaseSkill<GenerateTikTokCaptionInput, GeneratedTikTokCaption>
{
  public readonly name = 'generate_tiktok_caption';
  public readonly description =
    "Génère une caption TikTok + hashtags optimisés pour un business donné, en s'appuyant sur le script vidéo UGC si fourni. Anti-AI-vibes (pas d'em dash, pas de buzzwords corporate).";
  public readonly schema = GenerateTikTokCaptionInputSchema;

  public readonly displayName = 'Generate TikTok Caption';
  public readonly category = 'tiktok';
  public readonly order = 0;
  public readonly type = 'llm' as const;
  public readonly model = CLAUDE_MODEL;
  public readonly prompt = PROMPT;

  async execute(
    input: GenerateTikTokCaptionInput,
    _ctx?: SkillContext,
  ): Promise<GeneratedTikTokCaption> {
    const seed = newSeed();
    const userMessage = renderTemplate(this.prompt, {
      business: input.business,
      videoScript: input.videoScript ?? '(non fourni — écris la caption uniquement à partir du business)',
      languageName: input.languageName ?? 'English',
      maxHashtags: input.maxHashtags ?? 5,
      seed,
    });
    const raw = await callClaude({
      userMessage,
      schema: GeneratedTikTokCaptionSchema,
      effort: 'low',
    });

    // Sanitize same way as the X DM skill — kill em dashes etc.
    const sanitize = (s: string): string =>
      s
        .replace(/\s+[—–]\s+/g, ', ')
        .replace(/[—–]/g, ',')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/,\s*,/g, ',')
        .replace(/\s{2,}/g, ' ')
        .trim();

    // Re-build caption from sanitized body + hashtags to guarantee consistency.
    const cleanBody = sanitize(raw.captionBody);
    const cleanHashtags = raw.hashtags
      .map((h) => h.trim().replace(/^#/, '').toLowerCase())
      .filter((h) => h.length > 0)
      .slice(0, input.maxHashtags ?? 5);
    const fullCaption = `${cleanBody}\n\n${cleanHashtags.map((h) => `#${h}`).join(' ')}`.slice(0, 2200);

    return {
      caption: fullCaption,
      captionBody: cleanBody,
      hashtags: cleanHashtags,
      rationale: raw.rationale,
    };
  }
}
