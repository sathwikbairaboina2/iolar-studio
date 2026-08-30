import { z } from 'zod';

/**
 * Evidence, never media.
 *
 * The script is meant to be grounded in what a source actually said rather than
 * in a summary of it. For a video that would normally mean downloading it — so
 * this gathers the subtitle track instead. You can quote the exact words, with a
 * timestamp, having fetched no video at all.
 *
 * Acquiring footage is a separate concern and deliberately not done here.
 */

const candidateId = z.string().regex(/^[0-9a-f]{12}$/);

export const SegmentSchema = z
  .object({ startSec: z.number().min(0), endSec: z.number().min(0), text: z.string() })
  .strict();

export const EvidenceSchema = z
  .object({
    candidateId,
    /** `summary-only` means the source could not be read; the critic's pull quotes stand alone. */
    kind: z.enum(["transcript", "pagetext", "summary-only"]),
    retrievedAt: z.string().datetime(),
    text: z.string(),
    /** Present for a subtitle track, so a citation can point at a moment. */
    segments: z.array(SegmentSchema).nullable(),
  })
  .strict();

export type Segment = z.infer<typeof SegmentSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;

export function parseEvidence(raw: unknown): Evidence {
  const result = EvidenceSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`evidence: ${issue.path.join(".") || "root"} — ${issue.message}`);
  }
  return result.data;
}

/**
 * yt-dlp arguments that fetch subtitles and nothing else.
 *
 * Deliberately not built from the download path in `lib/fetchers/ytdlp.ts`: that
 * one selects a video format, and the two must not be one function with a flag,
 * because then one wrong argument downloads a video.
 */
export function buildTranscriptArgs(url: string, outBase: string): string[] {
  return [
    "--skip-download",
    "--write-auto-sub",
    "--write-sub",
    "--sub-lang",
    "en.*",
    "--sub-format",
    "vtt",
    "--no-playlist",
    "--no-progress",
    "-o",
    outBase,
    url,
  ];
}

const MEDIA_FLAGS = ["-f", "--format", "--download-sections", "--audio-format", "-x", "--extract-audio"];

/**
 * Refuses anything that would pull media down.
 *
 * The last line of defence before spawning: a guard here is cheap, and the cost
 * of being wrong is downloading video the user asked not to download.
 */
export function assertNoMediaDownload(args: string[]): void {
  const offender = args.find((a) => MEDIA_FLAGS.includes(a));
  if (offender) {
    throw new Error(`refusing to gather media: "${offender}" would download the source, not read it`);
  }
  if (!args.includes("--skip-download")) {
    throw new Error("refusing to run yt-dlp without --skip-download: gather reads sources, it does not fetch them");
  }
}

const TIMESTAMP = /^(?:(\d{2}):)?(\d{2}):(\d{2})[.,](\d{3})\s+-->\s+(?:(\d{2}):)?(\d{2}):(\d{2})[.,](\d{3})/;

function seconds(h: string | undefined, m: string, s: string, ms: string): number {
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

/** Strips the inline tags and cue settings auto-generated subtitles are full of. */
function cleanCue(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseVtt(vtt: string): Segment[] {
  const segments: Segment[] = [];
  const blocks = vtt.replace(/\r\n/g, "\n").split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block.split("\n");
    const at = lines.findIndex((l) => TIMESTAMP.test(l));
    if (at < 0) continue;

    const m = TIMESTAMP.exec(lines[at])!;
    const text = cleanCue(lines.slice(at + 1).join("\n"));
    if (!text) continue;

    segments.push({
      startSec: seconds(m[1], m[2], m[3], m[4]),
      endSec: seconds(m[5], m[6], m[7], m[8]),
      text,
    });
  }
  return segments;
}

export function evidenceFromVtt(candidateId: string, vtt: string, at: Date = new Date()): Evidence {
  const segments = parseVtt(vtt);
  return {
    candidateId,
    kind: "transcript",
    retrievedAt: at.toISOString(),
    // Both forms: the flat text is what a model reads, the segments are what a
    // citation points at.
    text: segments.map((s) => s.text).join(" "),
    segments,
  };
}
