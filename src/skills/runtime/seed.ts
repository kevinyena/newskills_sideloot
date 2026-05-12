import { randomBytes } from 'node:crypto';

/**
 * Random hex seed used to break prompt-prefix determinism on Opus 4.7
 * (which no longer accepts `temperature`/`top_p`/`top_k`).
 *
 * Injected into the user message as `{{seed}}` so two calls with otherwise
 * identical inputs produce different responses.
 */
export function newSeed(bytes = 8): string {
  return randomBytes(bytes).toString('hex');
}
