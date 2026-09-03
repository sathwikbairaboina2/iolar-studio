import type { Script } from './research/script';

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
  return textHash(voScript(reel));
}

/** FNV-1a of a string, base36; the fingerprint every "did the words change" check uses. */
export function textHash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** The script lines in order, spoken as one text. */
export function linesText(script: Script): string {
  return [...script.lines].sort((a, b) => a.order - b.order).map((l) => l.text.trim()).join(' ');
}

type Voiced = { pattern: { name: string } | null; beats: { text: string }[] };

/**
 * What the voiceover speaks: a pattern reel reads its approved script lines, a freeform
 * reel reads its beats. One definition, so the synthesiser, the aligner and the panel
 * that shows the text to a creator all agree.
 */
export function voScriptFor(reel: Voiced, script: Script | null): string {
  if (reel.pattern && script) return linesText(script);
  return voScript(reel);
}

export function scriptHashFor(reel: Voiced, script: Script | null): string {
  return textHash(voScriptFor(reel, script));
}

/** Whether the take on disk was made from the script the reel now has. */
export function voMatchesScript(reel: { beats: { text: string }[]; vo: { scriptHash?: string } }): boolean {
  return Boolean(reel.vo.scriptHash) && reel.vo.scriptHash === scriptHash(reel);
}
