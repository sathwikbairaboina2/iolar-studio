/**
 * The text the voiceover speaks.
 *
 * One definition, three readers: the local synthesiser, the aligner, and the creator who
 * copies it into a voice tool of their own. If the copy they paste differs from the string
 * the aligner is handed, every word timing lands on the wrong word.
 */
export function voScript(reel: { beats: { text: string }[] }): string {
  return reel.beats.map((b) => b.text.trim()).join(' ');
}

export function scriptWordCount(reel: { beats: { text: string }[] }): number {
  return voScript(reel).split(/\s+/).filter(Boolean).length;
}

/**
 * A fingerprint of the words the voiceover was made from.
 *
 * Stored with the take when it is aligned. It is how the studio can tell that a beat was
 * revised afterwards: the audio still plays and the timings still line up with it, so
 * nothing fails — the reel just quietly stops saying what the script says.
 */
export function scriptHash(reel: { beats: { text: string }[] }): string {
  const text = voScript(reel);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Whether the take on disk was made from the script the reel now has. */
export function voMatchesScript(reel: { beats: { text: string }[]; vo: { scriptHash?: string } }): boolean {
  return Boolean(reel.vo.scriptHash) && reel.vo.scriptHash === scriptHash(reel);
}
