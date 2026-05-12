import { z } from 'zod';
import type { BaseSkill, SkillContext } from '../BaseSkill.js';
import { callClaude, CLAUDE_MODEL } from '../runtime/anthropic.js';
import { renderTemplate } from '../runtime/render.js';
import { newSeed } from '../runtime/seed.js';
import { BusinessSchema, type Business } from './CreateBusinessIdeaSkill.js';

// ----- Schemas -----
export const GenerateVideoScriptInputSchema = z.object({
  business: BusinessSchema.describe('Idée business produite par CreateBusinessIdeaSkill'),
  languageName: z.string().describe("Langue de la réplique parlée — e.g. 'français'"),
});
export type GenerateVideoScriptInput = z.infer<typeof GenerateVideoScriptInputSchema>;

export const VideoScriptSchema = z.object({
  hook: z.string(),
  concept: z.string(),
  spokenLine: z.string(),
  emotion: z.string().optional(),
});
export type VideoScript = z.infer<typeof VideoScriptSchema>;

// ----- Prompt -----
const PROMPT = `# RÔLE
Tu es le meilleur CMO du monde, spécialiste de la viralité UGC sur TikTok et Reels. Tu connais par cœur les mécaniques de Alex Hormozi, MrBeast, et des top UGC creators. Tu as fait scaler des marques à 100k+ vues par vidéo de façon répétable.

# CE QUE TU SAIS SUR LA VIRALITÉ UGC
- Hook capture en 0.5s sinon scroll → pattern interrupt visuel + auditif obligatoire
- Hooks qui marchent : question intrigante, claim contre-intuitif, démo "wait what?", problème ultra-relatable, "POV: ...", "Tell me you... without telling me you..."
- Réalisme > production : un iPhone tenu à la main bat une caméra 4K stabilisée
- Le viewer doit penser "c'est un vrai humain", pas "c'est une pub"
- Émotion obligatoire : surprise, curiosité, FOMO, dégoût, joie
- 1 seule idée par vidéo, jamais de feature dump
- La parole = ancrage. Jamais de vidéo sans voix.

# MISSION
À partir du business fourni, conçois **1 concept de vidéo UGC ultra-virale**.

# CONTRAINTES TECHNIQUES (format Veo 3.1)
- Durée vidéo : 8 secondes
- 1 seul plan continu (aucune coupe)
- Format vertical 9:16
- La réplique parlée doit faire **6 à 15 mots max** (sinon ça ne rentre pas dans 8s)

# VARIANCE OBLIGATOIRE
Random seed : {{seed}}

Pour un même business, **propose un hook ET une réplique RADICALEMENT DIFFÉRENTS** à chaque seed. Change le pattern interrupt (problème → solution / POV / claim contre-intuitif / démo / réaction…), change la mécanique psychologique exploitée.

# INPUTS
- Business : {{business}}
- Langue de la réplique : {{languageName}}

# OUTPUT (JSON strict)
{
  "hook": "le hook (= la 1ère phrase qui hook le viewer) dans la langue cible",
  "concept": "explication en 1-2 phrases de POURQUOI ce concept va devenir viral (mécanique psychologique exploitée)",
  "spokenLine": "la réplique EXACTE et COMPLÈTE qui sera prononcée (6-15 mots), dans la langue cible",
  "emotion": "émotion principale exploitée (curiosity/fomo/surprise/relatable/...)"
}
`;

// ----- Skill -----
export class GenerateVideoScriptSkill
  implements BaseSkill<GenerateVideoScriptInput, VideoScript>
{
  public readonly name = 'generate_video_script';
  public readonly description =
    "Crée un concept de vidéo UGC viral à partir d'une idée business (hook, concept, réplique parlée).";
  public readonly schema = GenerateVideoScriptInputSchema;

  // ----- UI metadata -----
  public readonly displayName = 'Generate Video Script';
  public readonly category = 'video_ugc';
  public readonly order = 2;
  public readonly type = 'llm' as const;
  public readonly model = CLAUDE_MODEL;
  public readonly prompt = PROMPT;

  async execute(
    input: GenerateVideoScriptInput,
    _ctx?: SkillContext,
  ): Promise<VideoScript> {
    const seed = newSeed();
    const userMessage = renderTemplate(
      this.prompt,
      { ...input, seed } as unknown as Record<string, unknown>,
    );
    return callClaude({
      userMessage,
      schema: VideoScriptSchema,
      effort: 'high',
    });
  }
}
