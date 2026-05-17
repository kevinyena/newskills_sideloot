import { z } from 'zod';
import type { BaseSkill, SkillContext } from '../BaseSkill.js';
import { proxyDownload } from '../runtime/veo.js';
import { postVideo, type PostMode } from '../runtime/tiktok-api.js';

// ----- Schemas -----
export const PostTikTokVideoInputSchema = z.object({
  /**
   * URI of the rendered video. Supports any URL `proxyDownload()` can fetch
   * (Veo `videoUri`, or a public MP4 URL). For Veo-generated videos, pass
   * the `videoUri` from the GenerateVeoVideoSkill output.
   */
  videoUri: z
    .string()
    .min(1)
    .describe("URI de la vidéo source (Veo 3.1 ou URL publique d'un MP4)."),
  caption: z
    .string()
    .max(2200)
    .optional()
    .describe("Caption affichée sur le post TikTok. Max 2200 chars. Inutilisé en mode 'inbox' (le user finalise dans l'app)."),
  mode: z
    .enum(['inbox', 'direct'])
    .default('inbox')
    .describe(
      "'inbox' (default) : la vidéo arrive dans les drafts TikTok du user, il finalise + publie manuellement. Aucun audit TikTok nécessaire. " +
        "'direct' : poste live immédiatement. Requiert l'audit 'Content Posting API' + le scope `video.publish`.",
    ),
  privacyLevel: z
    .enum(['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'])
    .default('SELF_ONLY')
    .describe(
      "Niveau de privacy pour le post direct uniquement. Pour les sandbox accounts, X impose SELF_ONLY.",
    ),
});
export type PostTikTokVideoInput = z.infer<typeof PostTikTokVideoInputSchema>;

export const PostTikTokVideoOutputSchema = z.object({
  publishId: z.string().describe("ID du publish TikTok. Utilisable pour re-poller le statut."),
  status: z
    .enum(['inbox_delivered', 'published', 'failed', 'pending'])
    .describe(
      "État final. 'inbox_delivered' = vidéo dans les drafts de l'app TikTok du user. 'published' = visible publiquement. 'failed' = échec.",
    ),
  failReason: z.string().optional(),
  publicPostId: z.string().optional().describe('Si publié direct, ID public du post TikTok.'),
  videoSizeBytes: z.number().describe('Taille du fichier vidéo uploadé.'),
  fellBackToInbox: z
    .boolean()
    .optional()
    .describe("True si la requête direct a été refusée par TikTok (compte non privé en sandbox) et qu'on a re-tenté en inbox automatiquement."),
  fallbackReason: z
    .string()
    .optional()
    .describe("Code d'erreur TikTok qui a déclenché le fallback inbox (e.g. 'unaudited_client_can_only_post_to_private_accounts')."),
});
export type PostTikTokVideoOutput = z.infer<typeof PostTikTokVideoOutputSchema>;

// ----- Skill -----
export class PostTikTokVideoSkill
  implements BaseSkill<PostTikTokVideoInput, PostTikTokVideoOutput>
{
  public readonly name = 'post_tiktok_video';
  public readonly description =
    "Poste une vidéo MP4 (typiquement générée par Veo 3.1) sur le compte TikTok lié. Mode 'inbox' par défaut (drafts dans l'app TikTok, aucun audit requis) ou 'direct' (post live, requiert audit TikTok).";
  public readonly schema = PostTikTokVideoInputSchema;

  public readonly displayName = 'Post to TikTok';
  public readonly category = 'tiktok';
  public readonly order = 1;
  public readonly type = 'api' as const;
  public readonly endpoint = 'open.tiktokapis.com /v2/post/publish/...';

  async execute(input: PostTikTokVideoInput, ctx?: SkillContext): Promise<PostTikTokVideoOutput> {
    const mode: PostMode = input.mode ?? 'inbox';

    // 1. Download the video bytes (Veo URI requires the Gemini key — proxyDownload handles it).
    const { buffer } = await proxyDownload(input.videoUri);
    const videoSizeBytes = buffer.byteLength;
    // eslint-disable-next-line no-console
    console.log(
      `[post_tiktok_video] agent=${ctx?.agentId ?? '-'} mode=${mode} size=${(videoSizeBytes / 1_000_000).toFixed(2)}MB`,
    );

    // 2. Init + upload + poll until terminal. May silently fall back to inbox
    //    if TikTok refuses the direct-post for sandbox/audit reasons.
    const { publishId, finalStatus, fellBackToInbox, fallbackReason } = await postVideo({
      videoBuffer: buffer,
      caption: input.caption,
      mode,
      privacyLevel: input.privacyLevel,
    });

    // Map TikTok's status strings to our output enum.
    let status: PostTikTokVideoOutput['status'];
    switch (finalStatus.status) {
      case 'SEND_TO_USER_INBOX':
        status = 'inbox_delivered';
        break;
      case 'PUBLISH_COMPLETE':
        status = 'published';
        break;
      case 'FAILED':
        status = 'failed';
        break;
      default:
        // Poll timed out — caller can re-poll via /api/tiktok/status?publishId=...
        status = 'pending';
    }

    return {
      publishId,
      status,
      failReason: finalStatus.failReason,
      publicPostId: finalStatus.publicalyAvailablePostId,
      videoSizeBytes,
      fellBackToInbox,
      fallbackReason,
    };
  }
}
