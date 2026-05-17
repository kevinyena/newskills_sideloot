import { z } from 'zod';
import type { BaseSkill, SkillContext } from '../BaseSkill.js';
import {
  lookupUserByUsername,
  sendDm,
  getLinkedUserId,
  dmConversationHasEvents,
} from '../runtime/x-api.js';
import { expandSpintax } from '../runtime/spintax.js';

// ----- Schemas -----
// Raised from 10 → 30 to allow over-attempting candidates. The actual stop
// signal is `targetSuccesses` (we halt as soon as that many sends succeed).
// 30 is the upper bound to keep one run bounded — beyond that we recommend
// running another search.
const HARD_CAP = 30;
const DEFAULT_DELAY_MIN_MS = 5000;
const DEFAULT_DELAY_MAX_MS = 12000;

// X credit-based pay-as-you-go pricing (May 2026):
//   - DM Interaction (Create):  $0.015 per request   (POST /2/dm_conversations/.../messages)
//   - User Read:                 $0.010 per resource  (GET /2/users/by/username)
//   ⇒ one DM (lookup + send) ≈ $0.025
const PRICING = {
  userLookupPerCall: 0.010,
  dmSendPerCall: 0.015,
} as const;

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
  /** Min/max delay between sends — randomized to look human + dodge rate limits. */
  delayMinMs: z
    .number()
    .int()
    .min(1000)
    .max(60000)
    .default(DEFAULT_DELAY_MIN_MS)
    .describe('Délai minimum entre 2 envois (1-60s).'),
  delayMaxMs: z
    .number()
    .int()
    .min(1000)
    .max(60000)
    .default(DEFAULT_DELAY_MAX_MS)
    .describe("Délai maximum entre 2 envois (1-60s). On randomise dans [min, max] pour paraître humain."),
  /**
   * If set, the loop stops as soon as this many sends have succeeded. Lets
   * the caller "over-attempt" (pass 30 handles to guarantee 10 verified
   * opens). Untried handles are emitted as `skipped` events.
   */
  targetSuccesses: z
    .number()
    .int()
    .min(1)
    .max(HARD_CAP)
    .optional()
    .describe(
      "Stop dès N envois réussis. Permet d'over-tenter (ex: 30 handles → s'arrête à 10 ✓). Les handles non tentés sont émis en `skipped`.",
    ),
});
export type SendXDMsInput = z.infer<typeof SendXDMsInputSchema>;

export const DMResultSchema = z.object({
  handle: z.string(),
  /**
   * - 'sent'             : X returned a dm_event_id, message delivered
   * - 'likely_sent'      : X returned an error, but post-send verification
   *                        found a sender-from-me event in the convo
   *                        (covers the case where X gives 403 but the DM
   *                        actually went through)
   * - 'failed'           : X rejected AND verification couldn't confirm delivery
   */
  status: z.enum(['sent', 'likely_sent', 'failed']),
  variantUsed: z.string().optional(),
  dmEventId: z.string().optional(),
  error: z.string().optional(),
  /** URL of the X chat thread, when we know both participant IDs. */
  chatUrl: z.string().optional(),
  /** Categorized failure reason — soft, never used as ground truth. */
  failureKind: z
    .enum(['lookup_not_found', 'lookup_other', 'x_refused', 'x_other'])
    .optional(),
});
export type DMResult = z.infer<typeof DMResultSchema>;

export const SendCostSchema = z.object({
  userLookupCalls: z.number().describe("Nb d'appels /users/by/username (qu'ils aient réussi ou non — l'API facture tous les appels)."),
  dmSendCalls: z.number().describe("Nb d'appels /dm_conversations/.../messages effectivement tentés."),
  dmSendSuccesses: z.number().describe("Nb d'envois DM réussis."),
  costUsdEstimate: z.number().describe('Coût estimé total USD basé sur la grille X pay-as-you-go.'),
});

export const SendXDMsOutputSchema = z.object({
  results: z.array(DMResultSchema),
  sentCount: z.number(),
  failedCount: z.number(),
  skippedCount: z.number().describe('Handles non tentés car target successes déjà atteint.'),
  stoppedEarly: z.boolean().describe('True si on s\'est arrêté avant la fin de la liste (target successes atteint).'),
  cost: SendCostSchema,
});
export type SendXDMsOutput = z.infer<typeof SendXDMsOutputSchema>;

// ---------- Streaming progress events ----------

/**
 * Events emitted while iterating through handles. The streaming endpoint
 * (`/api/x-dm/send-stream`) forwards each as an SSE message so the UI can
 * render per-handle progress in real time.
 */
export type SendProgressEvent =
  | { kind: 'start'; total: number; targetSuccesses: number; variants: string[]; delayMinMs: number; delayMaxMs: number }
  | { kind: 'attempt'; index: number; handle: string; variant: string }
  | { kind: 'result'; index: number; result: DMResult }
  | { kind: 'delay'; ms: number; nextHandle: string }
  | { kind: 'skipped'; index: number; handle: string; reason: 'target_reached' }
  | { kind: 'done'; final: SendXDMsOutput };

/**
 * Soft categorization of a failure. We INTENTIONALLY don't say "DMs closed"
 * anymore — observed cases where X returned 403 yet the DM landed in the
 * recipient's inbox (anti-spam / duplicate detection trips even on real
 * deliveries). Now just two buckets:
 *   x_refused : X API said no (status 4xx) — could be permissions, rate
 *               limit, duplicate, or recipient setting. Verification step
 *               post-send tells us if it actually went through.
 *   x_other   : something else (5xx, network, timeout)
 */
function classifyDmFailure(msg: string): DMResult['failureKind'] {
  const low = msg.toLowerCase();
  if (low.includes('4') && (low.includes('http 4') || low.includes('40'))) return 'x_refused';
  return 'x_other';
}

function classifyLookupFailure(msg: string): DMResult['failureKind'] {
  const low = msg.toLowerCase();
  if (low.includes('not found') || low.includes('404')) return 'lookup_not_found';
  return 'lookup_other';
}

/** Build a clickable X chat URL when we know both user IDs. Order matters
 *  per X's UI: smaller ID first, separator, larger ID. (X normalizes the URL
 *  either way but this matches what the UI generates.) */
function buildChatUrl(myUserId: string | null, recipientUserId: string): string | undefined {
  if (!myUserId) return undefined;
  const [a, b] = BigInt(myUserId) < BigInt(recipientUserId)
    ? [myUserId, recipientUserId]
    : [recipientUserId, myUserId];
  return `https://x.com/messages/${a}-${b}`;
}

/**
 * Inner loop shared by `execute()` and the streaming endpoint. Emits progress
 * events through `onEvent` if provided — the callback may return a Promise
 * which we `await` so the streaming endpoint can guarantee each event is
 * flushed to the socket before the next API call begins.
 *
 * Returns the final aggregated output.
 */
export type SendProgressCallback = (e: SendProgressEvent) => void | Promise<void>;

export async function runSendDMs(
  input: SendXDMsInput,
  onEvent?: SendProgressCallback,
): Promise<SendXDMsOutput> {
  const handles = input.handles.slice(0, HARD_CAP);
  const variants =
    input.variants && input.variants.length > 0
      ? input.variants
      : expandSpintax(input.template, Math.max(handles.length, 6)).variants;
  if (variants.length === 0) {
    throw new Error('Aucune variante générée — le template est vide ou invalide.');
  }
  const delayMin = input.delayMinMs ?? DEFAULT_DELAY_MIN_MS;
  const delayMaxRaw = input.delayMaxMs ?? DEFAULT_DELAY_MAX_MS;
  // Guard: if user inverted min/max, swap silently rather than NaN-ing the math.
  const delayMax = Math.max(delayMin, delayMaxRaw);
  // Default: try every handle. Caller can pass targetSuccesses to stop early.
  const targetSuccesses = input.targetSuccesses ?? handles.length;

  await onEvent?.({
    kind: 'start',
    total: handles.length,
    targetSuccesses,
    variants,
    delayMinMs: delayMin,
    delayMaxMs: delayMax,
  });

  const results: DMResult[] = [];
  let userLookupCalls = 0;
  let dmSendCalls = 0;
  let dmSendSuccesses = 0;
  let stoppedEarly = false;
  // Fetch the linked user's X ID once — used to build chat URLs and to
  // run the "did the DM actually land?" verification on a 4xx.
  const myUserId = await getLinkedUserId();

  for (let i = 0; i < handles.length; i++) {
    // Stop as soon as we've hit the success target. Emit `skipped` events for
    // every remaining handle so the UI can mark them clearly.
    if (dmSendSuccesses >= targetSuccesses) {
      stoppedEarly = true;
      for (let j = i; j < handles.length; j++) {
        await onEvent?.({
          kind: 'skipped',
          index: j,
          handle: handles[j]!,
          reason: 'target_reached',
        });
      }
      break;
    }
    const handle = handles[i]!;
    // Rotate through variants — keeps a different opener per prospect.
    const variant = variants[i % variants.length]!;

    await onEvent?.({ kind: 'attempt', index: i, handle, variant });
    // eslint-disable-next-line no-console
    console.log(`[send_x_dms] ${i + 1}/${handles.length} → @${handle} lookup…`);

    let userId: string | undefined;
    try {
      userLookupCalls++;
      const user = await lookupUserByUsername(handle);
      userId = user.id;
      // eslint-disable-next-line no-console
      console.log(`[send_x_dms] ${i + 1}/${handles.length} → @${handle} lookup ok (id=${userId}), sending…`);
    } catch (e) {
      const msg = (e as Error).message;
      const result: DMResult = {
        handle,
        status: 'failed',
        variantUsed: variant,
        error: `lookup failed: ${msg}`,
        failureKind: classifyLookupFailure(msg),
      };
      results.push(result);
      await onEvent?.({ kind: 'result', index: i, result });
      if (i < handles.length - 1) {
        const ms = randomDelay(delayMin, delayMax);
        await onEvent?.({ kind: 'delay', ms, nextHandle: handles[i + 1]! });
        await sleep(ms);
      }
      continue;
    }

    try {
      dmSendCalls++;
      const dm = await sendDm(userId!, variant);
      dmSendSuccesses++;
      const result: DMResult = {
        handle,
        status: 'sent',
        variantUsed: variant,
        dmEventId: dm.dmEventId,
        chatUrl: buildChatUrl(myUserId, userId!),
      };
      results.push(result);
      // eslint-disable-next-line no-console
      console.log(`[send_x_dms] ${i + 1}/${handles.length} → @${handle} ✓ sent (event=${dm.dmEventId})`);
      await onEvent?.({ kind: 'result', index: i, result });
    } catch (e) {
      const msg = (e as Error).message;
      // X sometimes returns 4xx even when the message landed. If the failure
      // looks like an X refusal, verify by checking whether the conversation
      // now has events. If it does, treat as 'likely_sent' instead of 'failed'.
      let status: DMResult['status'] = 'failed';
      let verifyNote = '';
      const failureKind = classifyDmFailure(msg);
      if (failureKind === 'x_refused') {
        try {
          const verify = await dmConversationHasEvents(userId!);
          if (verify.exists) {
            status = 'likely_sent';
            dmSendSuccesses++; // count for the targetSuccesses gate
            verifyNote = ` · verified: convo has ${verify.eventCount ?? 'some'} events`;
          }
        } catch {
          // Verification call failed — keep status as 'failed'.
        }
      }
      const result: DMResult = {
        handle,
        status,
        variantUsed: variant,
        error: msg,
        failureKind,
        chatUrl: buildChatUrl(myUserId, userId!),
      };
      results.push(result);
      // eslint-disable-next-line no-console
      console.error(
        `[send_x_dms] ${i + 1}/${handles.length} → @${handle} ${
          status === 'likely_sent' ? '~likely_sent' : '✗'
        } ${msg}${verifyNote}`,
      );
      await onEvent?.({ kind: 'result', index: i, result });
    }

    // Variable delay between sends — except after the last one.
    if (i < handles.length - 1) {
      const ms = randomDelay(delayMin, delayMax);
      await onEvent?.({ kind: 'delay', ms, nextHandle: handles[i + 1]! });
      await sleep(ms);
    }
  }

  const costUsdEstimate = Number(
    (
      userLookupCalls * PRICING.userLookupPerCall +
      dmSendCalls * PRICING.dmSendPerCall
    ).toFixed(4),
  );

  const final: SendXDMsOutput = {
    results,
    sentCount: results.filter((r) => r.status === 'sent').length,
    failedCount: results.filter((r) => r.status === 'failed').length,
    skippedCount: handles.length - results.length,
    stoppedEarly,
    cost: {
      userLookupCalls,
      dmSendCalls,
      dmSendSuccesses,
      costUsdEstimate,
    },
  };
  await onEvent?.({ kind: 'done', final });
  return final;
}

function randomDelay(minMs: number, maxMs: number): number {
  if (maxMs <= minMs) return minMs;
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// ----- Skill -----
export class SendXDMsSkill implements BaseSkill<SendXDMsInput, SendXDMsOutput> {
  public readonly name = 'send_x_dms';
  public readonly description =
    "Envoie un DM X à chaque @handle de la liste, en piochant une variante différente du template Spintax. Cap dur à 10/run + délai randomisé entre sends (5-12s par défaut, 'humain'). Coût pay-as-you-go: ~$0.025 / DM (lookup $0.010 + send $0.015).";
  public readonly schema = SendXDMsInputSchema;

  public readonly displayName = 'Send X DMs';
  public readonly category = 'x_dm';
  public readonly order = 4;
  public readonly type = 'api' as const;
  public readonly endpoint = 'twitter.com /2/dm_conversations/with/:id/messages';

  async execute(input: SendXDMsInput, _ctx?: SkillContext): Promise<SendXDMsOutput> {
    return runSendDMs(input);
  }
}
