import { z } from 'zod';
import type { BaseSkill, SkillContext } from '../BaseSkill.js';
import { callClaude, CLAUDE_MODEL } from '../runtime/anthropic.js';
import { renderTemplate } from '../runtime/render.js';
import { BusinessSchema } from './CreateBusinessIdeaSkill.js';
import { VideoScriptSchema } from './GenerateVideoScriptSkill.js';

// ----- Schemas -----
export const AdaptToVeoPromptInputSchema = z.object({
  business: BusinessSchema,
  video: VideoScriptSchema,
  languageName: z.string().describe("Langue parlée dans la vidéo — e.g. 'français'"),
});
export type AdaptToVeoPromptInput = z.infer<typeof AdaptToVeoPromptInputSchema>;

export const VeoPromptSchema = z.object({
  veoPrompt: z.string(),
});
export type VeoPromptOutput = z.infer<typeof VeoPromptSchema>;

// ----- Prompt -----
const PROMPT = `# RÔLE
Tu es prompt engineer senior spécialisé Veo 3.1. Tu sais exactement comment formuler un prompt pour obtenir une vidéo UGC indiscernable d'une vraie capture iPhone.

# OBJECTIF
Transformer le concept vidéo fourni en **prompt Veo 3.1 complet en ANGLAIS**, qui maximise le réalisme et **garantit l'audio + dialogue parlé synchronisé**.

# STRUCTURE OBLIGATOIRE (dans cet ordre exact)
1. **Style** : "Hyper-realistic UGC vertical video, shot on iPhone 15 Pro, handheld, 9:16, natural lighting, documentary realism, candid, no filter, authentic skin texture, slight camera shake"
2. **Sujet** : âge précis, ethnicité, look, vêtement, expression initiale (ex: "a 26-year-old woman with messy bun, oversized hoodie, no makeup, slightly tired eyes")
3. **Décor** : lieu crédible et précis (chambre, voiture, café, salle de bain, cuisine, rue)
4. **Action en 1 plan continu** : ce que la personne fait + évolution d'expression
5. **Dialogue (OBLIGATOIRE)** — écris EXACTEMENT cette phrase :
   > The person speaks out loud directly into the camera, with clearly audible voice and perfectly synchronized lip movement. She/He says: "[la spokenLine intacte dans la langue cible]". Their voice is clear, natural, conversational tone, recorded by the phone microphone close to their face.
6. **Audio** — écris EXACTEMENT :
   > Audio: clearly audible human speech in the foreground, intimate close-mic recording, natural ambient room tone in the background, no background music, no voice-over, no narration — only the on-camera person speaking their line.
7. **Cinematography** : "Single continuous take, slight handheld movement, shallow depth of field"

# INTERDICTIONS ABSOLUES
- Ne JAMAIS écrire "silent", "no sound", "no audio" (Veo générerait alors une vidéo muette)
- Ne JAMAIS modifier la spokenLine (elle doit apparaître intacte entre guillemets dans le bloc dialogue)
- Ne JAMAIS ajouter de musique de fond
- Ne JAMAIS proposer plusieurs plans / coupes

# INPUTS
- Business : {{business}}
- Vidéo (hook, concept, spokenLine) : {{video}}
- Langue parlée dans la vidéo : {{languageName}}

# OUTPUT (JSON strict)
{
  "veoPrompt": "le prompt Veo 3.1 complet en anglais, en un seul bloc de texte continu, suivant la structure ci-dessus"
}
`;

// ----- Skill -----
export class AdaptToVeoPromptSkill
  implements BaseSkill<AdaptToVeoPromptInput, VeoPromptOutput>
{
  public readonly name = 'adapt_to_veo_prompt';
  public readonly description =
    'Transforme un script vidéo en prompt Veo 3.1 ultra-précis (réalisme photoréaliste + dialogue audible synchronisé).';
  public readonly schema = AdaptToVeoPromptInputSchema;

  // ----- UI metadata -----
  public readonly displayName = 'Adapt Script to Veo Prompt';
  public readonly category = 'video_ugc';
  public readonly order = 3;
  public readonly type = 'llm' as const;
  public readonly model = CLAUDE_MODEL;
  public readonly prompt = PROMPT;

  async execute(
    input: AdaptToVeoPromptInput,
    _ctx?: SkillContext,
  ): Promise<VeoPromptOutput> {
    const userMessage = renderTemplate(this.prompt, input as unknown as Record<string, unknown>);
    // Lower effort here: deterministic structural transform, not creative ideation.
    return callClaude({
      userMessage,
      schema: VeoPromptSchema,
      effort: 'medium',
    });
  }
}
