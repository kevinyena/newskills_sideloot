/**
 * Spintax expander.
 *
 * Input:  "{hi/hello/hey} {firstName} — I {saw/found/spotted} your {project/work}!"
 * Output: up to N unique variants, each picking one option per `{a/b/c}` group.
 *
 * Used by the X DM skill so a single Claude-generated template yields the
 * 6+ unique variants the user asked for.
 */

interface SpintaxPart {
  type: 'static' | 'group';
  /** for `static`: the literal text. for `group`: the index into `groups`. */
  value: string | number;
}

interface ParsedSpintax {
  parts: SpintaxPart[];
  groups: string[][];
  /** Total number of distinct combinations possible. */
  totalCombos: number;
}

export function parseSpintax(template: string): ParsedSpintax {
  const parts: SpintaxPart[] = [];
  const groups: string[][] = [];
  const re = /\{([^{}]+)\}/g;
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    if (m.index > lastEnd) {
      parts.push({ type: 'static', value: template.slice(lastEnd, m.index) });
    }
    const raw = m[1] ?? '';
    // A spintax group needs at least one "/" — otherwise treat it as static
    // text. This avoids accidentally matching `{firstName}` template tokens
    // when callers want to substitute named placeholders later.
    if (!raw.includes('/')) {
      parts.push({ type: 'static', value: m[0] });
    } else {
      const opts = raw.split('/').map((s) => s.trim()).filter((s) => s.length > 0);
      if (opts.length === 0) {
        parts.push({ type: 'static', value: m[0] });
      } else {
        groups.push(opts);
        parts.push({ type: 'group', value: groups.length - 1 });
      }
    }
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd < template.length) {
    parts.push({ type: 'static', value: template.slice(lastEnd) });
  }
  const totalCombos = groups.reduce((acc, g) => acc * g.length, 1);
  return { parts, groups, totalCombos };
}

/** Pick one variant deterministically given a combo index. */
function variantFromCombo(parsed: ParsedSpintax, comboIndex: number): string {
  let idx = comboIndex;
  const picks: number[] = [];
  for (const g of parsed.groups) {
    picks.push(idx % g.length);
    idx = Math.floor(idx / g.length);
  }
  return parsed.parts
    .map((p) => {
      if (p.type === 'static') return p.value as string;
      const group = parsed.groups[p.value as number]!;
      const pick = picks[p.value as number]!;
      return group[pick]!;
    })
    .join('');
}

export interface ExpandResult {
  variants: string[];
  totalCombos: number;
  /** True iff we returned exactly `count` unique variants. */
  satisfied: boolean;
}

/**
 * Expand a spintax template into up to `count` unique variants.
 *
 * Strategy: shuffle indices [0, totalCombos), take the first `count`.
 * Guarantees uniqueness and full coverage when `count <= totalCombos`.
 */
export function expandSpintax(template: string, count: number): ExpandResult {
  const parsed = parseSpintax(template);
  const cap = Math.min(count, parsed.totalCombos);

  const variants: string[] = [];
  if (parsed.totalCombos === 0 || parsed.parts.length === 0) {
    return { variants: [template], totalCombos: 1, satisfied: count <= 1 };
  }

  // Reservoir-style: build the index list 0..totalCombos-1 then shuffle.
  // Cap totalCombos enumeration to avoid blowing memory on monstrous templates.
  const totalForEnum = Math.min(parsed.totalCombos, 10_000);
  const indices = Array.from({ length: totalForEnum }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = indices[i]!;
    const b = indices[j]!;
    indices[i] = b;
    indices[j] = a;
  }
  for (let i = 0; i < indices.length && variants.length < cap; i++) {
    variants.push(variantFromCombo(parsed, indices[i]!));
  }
  return {
    variants,
    totalCombos: parsed.totalCombos,
    satisfied: variants.length === count,
  };
}
