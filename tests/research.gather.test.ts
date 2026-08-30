import { describe, it, expect } from 'vitest';
import {
  buildTranscriptArgs,
  assertNoMediaDownload,
  parseVtt,
  evidenceFromVtt,
  parseEvidence,
} from '@/lib/reel/research/gather';

/**
 * Gather collects evidence, never media.
 *
 * The script has to be grounded in what a source actually said rather than in a
 * summary of it, and that grounding must not cost a video download. A subtitle
 * track gives both.
 */

const URL_ = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

describe("buildTranscriptArgs", () => {
  it("skips the download", () => {
    expect(buildTranscriptArgs(URL_, "/out/abc")).toContain("--skip-download");
  });

  it("asks for the subtitle track", () => {
    const args = buildTranscriptArgs(URL_, "/out/abc");
    expect(args).toContain("--write-auto-sub");
    expect(args).toContain("--write-sub");
  });

  it("never carries a format selector, which is what would fetch video", () => {
    const args = buildTranscriptArgs(URL_, "/out/abc");
    expect(args).not.toContain("-f");
    expect(args.some((a) => a.startsWith("bv"))).toBe(false);
  });

  it("never carries a download-sections range", () => {
    expect(buildTranscriptArgs(URL_, "/out/abc")).not.toContain("--download-sections");
  });

  it("passes the url last", () => {
    expect(buildTranscriptArgs(URL_, "/out/abc").at(-1)).toBe(URL_);
  });
});

describe("assertNoMediaDownload", () => {
  it("passes the transcript args", () => {
    expect(() => assertNoMediaDownload(buildTranscriptArgs(URL_, "/out/abc"))).not.toThrow();
  });

  it("refuses a format selector", () => {
    expect(() => assertNoMediaDownload(["-f", "bv*+ba", "--no-playlist", URL_])).toThrow(/media/i);
  });

  it("refuses a download-sections range", () => {
    expect(() => assertNoMediaDownload(["--download-sections", "*10-20", "--skip-download", URL_])).toThrow(
      /media/i
    );
  });

  it("refuses args that simply forgot to skip the download", () => {
    expect(() => assertNoMediaDownload(["--write-auto-sub", "--no-playlist", URL_])).toThrow(/skip-download/);
  });

  // The guard is the last line of defence, so it names the offending flag.
  it("says which flag it objected to", () => {
    expect(() => assertNoMediaDownload(["-f", "bv*", "--skip-download", URL_])).toThrow(/-f/);
  });
});

const VTT = `WEBVTT

00:00:01.000 --> 00:00:04.500
xAI just gave its agents

00:00:04.500 --> 00:00:08.000
their own computer to work in.

00:00:08.000 --> 00:00:11.250
Every call opens a fresh box.
`;

describe("parseVtt", () => {
  it("reads each cue as a timed segment", () => {
    const segments = parseVtt(VTT);

    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ startSec: 1, endSec: 4.5, text: "xAI just gave its agents" });
  });

  it("handles an hour-long timestamp", () => {
    const segments = parseVtt("WEBVTT\n\n01:02:03.500 --> 01:02:05.000\nlate in the video\n");
    expect(segments[0].startSec).toBeCloseTo(3723.5, 3);
  });

  it("joins a cue split over two lines", () => {
    const segments = parseVtt("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nfirst part\nsecond part\n");
    expect(segments[0].text).toBe("first part second part");
  });

  it("drops the positioning and styling noise auto-subs carry", () => {
    const noisy = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000 align:start position:0%\n<c>hello</c> there\n";
    expect(parseVtt(noisy)[0].text).toBe("hello there");
  });

  it("returns nothing for a file with no cues", () => {
    expect(parseVtt("WEBVTT\n\n")).toEqual([]);
  });
});

describe("evidenceFromVtt", () => {
  it("carries the full text as well as the segments, so a quote can be found either way", () => {
    const ev = evidenceFromVtt("a1b2c3d4e5f6", VTT);

    expect(ev.kind).toBe("transcript");
    expect(ev.segments).toHaveLength(3);
    expect(ev.text).toContain("their own computer to work in.");
  });

  it("round-trips through the schema", () => {
    expect(() => parseEvidence(evidenceFromVtt("a1b2c3d4e5f6", VTT))).not.toThrow();
  });
});

describe("parseEvidence", () => {
  const ok = {
    candidateId: "a1b2c3d4e5f6",
    kind: "pagetext",
    retrievedAt: "2026-08-30T21:40:00.000Z",
    text: "the page said this",
    segments: null,
  };

  it("accepts page text with no segments", () => {
    expect(parseEvidence(ok).kind).toBe("pagetext");
  });

  it("names the bad field", () => {
    expect(() => parseEvidence({ ...ok, candidateId: "nope" })).toThrow(/candidateId/);
  });

  it("rejects an unknown kind", () => {
    expect(() => parseEvidence({ ...ok, kind: "video" })).toThrow(/kind/);
  });

  // A source that could not be gathered still has the critic's pull quotes.
  it("accepts a summary-only record for a source that could not be read", () => {
    const ev = parseEvidence({ ...ok, kind: "summary-only", text: "", segments: null });
    expect(ev.kind).toBe("summary-only");
  });
});
