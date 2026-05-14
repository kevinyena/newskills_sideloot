import { z } from 'zod';
import type { BaseSkill, SkillContext } from '../BaseSkill.js';
import { lookupUserByUsername, sendDm } from '../runtime/x-api.js';
import { expandSpintax } from '../runtime/spintax.js';

// ----- Schemas -----
const HARD_CAP = 10;
const DELAY_MS_DEFAULT = 7000;

export const SendXDMsInputSchema = z.object({
  /** Spintax template (or raw text). We auto-expand here too. */
  template: z
    .string()
    .min(10)
    .describe('Template Spintax {a/b/c} ou texte brut. Au moins 1 variante sera générée par DM.'),
  /** List of @handles (or bare usernames) to DM. Cap at HARD_CAP. */
  handles: z
    .array(z.string())
    .min(1)
    .max(HARD_CAP)
    .describe(`Liste de @handles X (max ${HARD_CAP} par run pour éviter le ban).`),
  /** Optional: pre-computed variants. If absent, we expand from template. */
  variants: z.array(z.string()).optional(),
  /** Delay between sends to look human + dodge rate limits. */
  delayMs: z
    .number()
    .int()
    .min(2000)
    .max(60000)
    .default(DELAY_MS_DEFAULT)
    .describe('Délai entre 2 envois (2-60s). Default 7s.'),
});
export type SendXDMsInput = z.infer<typeof SendXDMsInputSchema>;

export const DMResultSchema = z.object({
  handle: z.string(),
  status: z.enum(['sent', 'failed']),
  variantUsed: z.string().optional(),
  dmEventId: z.string().optional(),
  error: z.string().optional(),
});

export const SendXDMsOutputSchema = z.object({
  results: z.array(DMResultSchema),
  sentCount: z.number(),
  failedCount: z.number(),
});
export type SendXDMsOutput = z.infer<typeof SendXDMsOutputSchema>;

// ----- Skill -----
export class SendXDMsSkill implements BaseSkill<SendXDMsInput, SendXDMsOutput> {
  public readonly name = 'send_x_dms';
  public readonly description =
    'Envoie un DM X à chaque @handle de la liste, en piochant une variante différente du template Spintax. Cap dur à 10/run + délai obligatoire entre sends pour limiter le risque de ban.';
  public readonly schema = SendXDMsInputSchema;

  public readonly displayName = 'Send X DMs';
  public readonly category = 'x_dm';
  public readonly order = 3;
  public readonly type = 'api' as const;
  public readonly endpoint = 'twitter.com /2/dm_conversations/with/:id/messages';

  async execute(input: SendXDMsInput, _ctx?: SkillContext): Promise<SendXDMsOutput> {
    const handles = input.handles.slice(0, HARD_CAP);
    const variants =
      input.variants && input.variants.length > 0
        ? input.variants
        : expandSpintax(input.template, Math.max(handles.length, 6)).variants;
    if (variants.length === 0) {
      throw new Error('Aucune variante générée — le template est vide ou invalide.');
    }
    const delayMs = input.delayMs ?? DELAY_MS_DEFAULT;

    const results: SendXDMsOutput['results'] = [];
    for (let i = 0; i < handles.length; i++) {
      const handle = handles[i]!;
      // Rotate through variants — keeps a different opener per prospect.
      const variant = variants[i % variants.length]!;
      try {
        const user = await lookupUserByUsername(handle);
        const dm = await sendDm(user.id, variant);
        results.push({
          handle,
          status: 'sent',
          variantUsed: variant,
          dmEventId: dm.dmEventId,
        });
      } catch (e) {
        results.push({
          handle,
          status: 'failed',
          variantUsed: variant,
          error: (e as Error).message,
        });
      }
      // Don't sleep after the last one
      if (i < handles.length - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    return {
      results,
      sentCount: results.filter((r) => r.status === 'sent').length,
      failedCount: results.filter((r) => r.status === 'failed').length,
    };
  }
}
