// Moved from lib/graph.ts unchanged, so a chapter on slicing and a reel on slicing still collide.

/** Normalises a phrase to a topic key so the same concept from different chapters collides. */
export function topicKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/`[^`]*`/g, ' ')
    .replace(/[^a-z0-9+#. ]+/g, ' ')
    .replace(/\b(the|a|an|and|or|of|to|in|for|with|is|are|its|it|you|your|how|what|why|when|use|using|python|vs)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pulls the salient topic phrase out of a syllabus point ("Slicing: lst[1:4] ..." -> "slicing"). */
export function topicFromPoint(point: string): string {
  // "1. Slicing basics" and "Slicing basics" are one topic; the list number is layout, not meaning.
  const head = point.replace(/^\s*\d+[.)]\s*/, '').split(/[:—–\-(]/)[0];
  return topicKey(head).split(' ').filter(Boolean).slice(0, 4).join(' ');
}
