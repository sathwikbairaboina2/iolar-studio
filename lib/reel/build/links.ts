import type { Candidate } from '../research/candidate';
import type { Script } from '../research/script';

/**
 * Turning a beat back into the page that proves it.
 *
 * This is the join the whole build hangs on. A `screen` beat carries the id of
 * the script line it was cut from; that line carries citations; each citation is
 * a candidate the critic kept, holding a canonical URL and the pull quotes it
 * was kept for. `webpage-mp4` wants exactly a url and a phrase.
 *
 * So the shot for a line is its own evidence, on screen, with the marker
 * sweeping the sentence that supports it. Nothing here invents a link: a beat
 * whose line cites nothing resolves to null and waits for a human, because a
 * page visit with no source is the fabrication this pipeline exists to prevent.
 */

export type ResolvedLink = { url: string; highlight: string; candidateId: string };

/**
 * Picks the strongest citation on a line and the phrase to sweep on it.
 *
 * Strongest means the critic's own `scoreTotal` — it already ranked these, and
 * ranking them again here would be a second opinion nobody asked for. The
 * highlight is the candidate's first pull quote, falling back to the line's own
 * words, which is what the plugin does with a missing phrase anyway.
 */
export function resolveLink(
  script: Pick<Script, 'lines'>,
  candidates: Candidate[],
  lineId: string | null
): ResolvedLink | null {
  if (!lineId) return null;
  const line = script.lines.find((l) => l.id === lineId);
  if (!line || line.citations.length === 0) return null;

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const cited = line.citations.map((id) => byId.get(id)).filter((c): c is Candidate => Boolean(c));
  if (cited.length === 0) return null;

  const best = cited.reduce((a, b) => (b.scoreTotal > a.scoreTotal ? b : a));
  const url = best.canonicalUrl || best.url;
  if (!url) return null;

  const quote = best.pullQuotes?.[0]?.text?.trim();
  return {
    url,
    // A quote long enough to be a paragraph is not a phrase a marker can sweep,
    // and the plugin scrolls to what it can find.
    highlight: quote && quote.length <= 180 ? quote : line.text.trim(),
    candidateId: best.id,
  };
}
