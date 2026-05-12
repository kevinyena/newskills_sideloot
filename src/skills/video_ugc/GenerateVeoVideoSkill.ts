import { z } from 'zod';
import type { BaseSkill, SkillContext } from '../BaseSkill.js';
import { runBlocking, VEO_MODEL, type AspectRatio } from '../runtime/veo.js';

// ----- Schemas -----
export const GenerateVeoVideoInputSchema = z.object({
  veoPrompt: z
    .string()
    .min(10)
    .describe('Prompt Veo 3.1 complet (anglais, structuré). Produit par AdaptToVeoPromptSkill.'),
  aspectRatio: z
    .enum(['9:16', '16:9'])
    .default('9:16')
    .describe('Format vidéo. 9:16 pour Reels/TikTok, 16:9 pour YouTube.'),
  durationSeconds: z.number().int().min(4).max(8).default(8).optional(),
});
export type GenerateVeoVideoInput = z.infer<typeof GenerateVeoVideoInputSchema>;

export const GenerateVeoVideoOutputSchema = z.object({
  videoUri: z.string(),
  operationName: z.string(),
});
export type GenerateVeoVideoOutput = z.infer<typeof GenerateVeoVideoOutputSchema>;

// ----- Skill -----
/**
 * Blocking Veo 3.1 generation skill. Returns once the video is ready (1–3 minutes).
 *
 * For interactive UIs that need a progress indicator, use the underlying
 * `runtime/veo.ts` primitives (`startGeneration` + `pollStatus` + `proxyDownload`)
 * directly. This skill is the agent-blocking path (Mintery-style).
 */
export class GenerateVeoVideoSkill
  implements BaseSkill<GenerateVeoVideoInput, GenerateVeoVideoOutput>
{
  public readonly name = 'generate_veo_video';
  public readonly description =
    'Génère une vidéo via Veo 3.1 (8s, audio synchronisé). Bloque jusqu\'à ce que la vidéo soit prête (1–3 min).';
  public readonly schema = GenerateVeoVideoInputSchema;

  // ----- UI metadata -----
  public readonly displayName = 'Generate Video (Veo 3.1)';
  public readonly category = 'video_ugc';
  public readonly order = 4;
  public readonly type = 'api' as const;
  public readonly endpoint = VEO_MODEL;

  async execute(
    input: GenerateVeoVideoInput,
    ctx?: SkillContext,
  ): Promise<GenerateVeoVideoOutput> {
    const result = await runBlocking({
      prompt: input.veoPrompt,
      aspectRatio: (input.aspectRatio ?? '9:16') as AspectRatio,
      durationSeconds: input.durationSeconds,
      onProgress: ({ elapsedMs, done }) => {
        if (ctx?.agentId) {
          // eslint-disable-next-line no-console
          console.log(
            `[GenerateVeoVideoSkill] agent=${ctx.agentId} elapsed=${Math.round(elapsedMs / 1000)}s done=${done}`,
          );
        }
      },
    });
    return result;
  }
}
