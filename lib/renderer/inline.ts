/** Inline markers inside block strings. Escaped first, then marked up, so text can never inject HTML. */
export const INLINE_INKS = ['blue', 'red', 'green', 'black', 'purple', 'orange', 'pink'] as const;

/** `{icon:name}` is resolved by the caller (the server renderer passes real SVGs); the client never touches fs. */
export type InlineOpts = { icon?: (name: string) => string };
const ICON_RE = /\{icon:([^{}\n]+?)\}/g;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const INK_RE = new RegExp(`\\{(${INLINE_INKS.join('|')}):([^{}\\n]+?)\\}`, 'g');
const MARKERS: [RegExp, string][] = [
  // A lone `=` may sit inside a highlight ("answer = 4"); only a double one closes it.
  [/==((?:[^=\n]|=(?!=))+?)==/g, '<mark class="hl">$1</mark>'],
  [/\*\*([^*\n]+?)\*\*/g, '<span class="em">$1</span>'],
  [/__([^_\n]+?)__/g, '<span class="ul">$1</span>'],
  [INK_RE, '<span class="ink-$1">$2</span>'],
];

/** Code spans are lifted out first so `__init__` or `a**b` inside them stay literal. */
function splitCode(s: string): { text: string; codes: string[] } {
  const codes: string[] = [];
  const text = s.replace(/`([^`\n]+?)`/g, (_, inner: string) => {
    codes.push(inner);
    return `\u0000${codes.length - 1}\u0000`;
  });
  return { text, codes };
}

export function renderInline(s: string, opts: InlineOpts = {}): string {
  const { text, codes } = splitCode(escapeHtml(s));
  let out = text;
  for (const [re, rep] of MARKERS) out = out.replace(re, rep);
  out = out.replace(ICON_RE, (_, name: string) => (opts.icon ? opts.icon(name.trim()) : ''));
  return out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code class="mono">${codes[Number(i)]}</code>`);
}

export function stripInline(s: string): string {
  const { text, codes } = splitCode(s);
  let out = text;
  for (const [re, rep] of MARKERS) out = out.replace(re, rep.includes('$2') ? '$2' : '$1');
  out = out.replace(ICON_RE, '').replace(/  +/g, ' ').trim();
  return out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[Number(i)]);
}
