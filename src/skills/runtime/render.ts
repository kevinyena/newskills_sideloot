/** Substitute `{{var}}` tokens in a template. Objects are JSON-stringified. */
export function renderTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    const v = vars[k];
    if (v === undefined || v === null) return '';
    return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  });
}
