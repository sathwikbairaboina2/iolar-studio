/**
 * Splits page text into passages of about `maxTokens` words, breaking on sentence ends
 * where it can. A token here is a whitespace word; nomic's own tokens run ~1.3 per word,
 * so 400 words sits inside its 2048 window with room for the prefix.
 */
export function chunkText(text: string, maxTokens = 400): string[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/);
  const out: string[] = [];
  let cur: string[] = [];
  let count = 0;
  const flush = () => {
    if (cur.length) {
      out.push(cur.join(' '));
      cur = [];
      count = 0;
    }
  };
  for (const s of sentences) {
    const words = s.split(' ').length;
    if (words > maxTokens) {
      flush();
      const ws = s.split(' ');
      for (let i = 0; i < ws.length; i += maxTokens) out.push(ws.slice(i, i + maxTokens).join(' '));
      continue;
    }
    if (count + words > maxTokens) flush();
    cur.push(s);
    count += words;
  }
  flush();
  return out.filter((c) => c.trim().length > 0);
}
