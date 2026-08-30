import { describe, it, expect } from 'vitest';
import {
  uncitedLines,
  spokenWordCount,
  canApprove,
  dropLine,
  reorderLines,
  citationsFor,
} from '@/lib/reel/research/scriptBoard';
import type { ScriptLine } from '@/lib/reel/research/script';

/**
 * Everything the review screen decides, kept out of the component so it can be
 * tested at all. The screen renders these answers; it does not compute them.
 */

const line = (over: Partial<ScriptLine> = {}): ScriptLine => ({
  id: "l1",
  order: 0,
  role: "hook",
  text: "xAI just gave its agents their own computer.",
  citations: ["a1b2c3d4e5f6"],
  assetIds: [],
  note: null,
  commentary: false,
  ...over,
});

describe("uncitedLines", () => {
  it("names a factual line with no source", () => {
    expect(uncitedLines([line({ citations: [] })])).toEqual(["l1"]);
  });

  it("leaves a commentary line alone, since an opinion needs no source", () => {
    expect(uncitedLines([line({ citations: [], commentary: true })])).toEqual([]);
  });

  it("says nothing when every line is cited", () => {
    expect(uncitedLines([line(), line({ id: "l2", order: 1 })])).toEqual([]);
  });
});

describe("spokenWordCount", () => {
  it("counts the words that will be said", () => {
    expect(spokenWordCount([line({ text: "one two three four five" })])).toBe(5);
  });

  it("adds the lines together", () => {
    expect(spokenWordCount([line({ text: "one two" }), line({ id: "l2", order: 1, text: "three" })])).toBe(3);
  });

  it("is not confused by double spaces or trailing whitespace", () => {
    expect(spokenWordCount([line({ text: "  one   two  " })])).toBe(2);
  });

  it("counts a commentary line, because it is still spoken", () => {
    expect(spokenWordCount([line({ text: "just three words", commentary: true })])).toBe(3);
  });
});

describe("canApprove", () => {
  it("allows a fully cited script", () => {
    expect(canApprove({ lines: [line()], status: "draft" })).toBe(true);
  });

  it("refuses while a factual line is uncited", () => {
    expect(canApprove({ lines: [line({ citations: [] })], status: "draft" })).toBe(false);
  });

  it("refuses an empty script", () => {
    expect(canApprove({ lines: [], status: "draft" })).toBe(false);
  });

  // The research not finding something is an answer, not a defect.
  it("allows approval even with an unproven brief claim", () => {
    expect(canApprove({ lines: [line()], status: "draft" })).toBe(true);
  });

  it("refuses a script that is already approved, since there is nothing to do", () => {
    expect(canApprove({ lines: [line()], status: "approved" })).toBe(false);
  });
});

describe("dropLine", () => {
  it("removes the line", () => {
    const out = dropLine([line(), line({ id: "l2", order: 1 })], "l1");
    expect(out.map((l) => l.id)).toEqual(["l2"]);
  });

  it("closes the gap in order, so the remaining lines stay contiguous", () => {
    const out = dropLine([line(), line({ id: "l2", order: 1 }), line({ id: "l3", order: 2 })], "l2");
    expect(out.map((l) => l.order)).toEqual([0, 1]);
  });
});

describe("reorderLines", () => {
  it("moves a line and renumbers", () => {
    const lines = [line(), line({ id: "l2", order: 1 }), line({ id: "l3", order: 2 })];
    const out = reorderLines(lines, "l3", 0);
    expect(out.map((l) => l.id)).toEqual(["l3", "l1", "l2"]);
    expect(out.map((l) => l.order)).toEqual([0, 1, 2]);
  });

  it("leaves the list alone for an id that is not in it", () => {
    const lines = [line()];
    expect(reorderLines(lines, "nope", 0).map((l) => l.id)).toEqual(["l1"]);
  });
});

describe("citationsFor", () => {
  const candidates = [
    { id: "a1b2c3d4e5f6", title: "xAI ships agent sandboxes", publisher: "The Verge" },
    { id: "f6e5d4c3b2a1", title: "Sandbox internals", publisher: "xAI docs" },
  ];

  it("resolves the ids to something a human can read", () => {
    const out = citationsFor(line({ citations: ["a1b2c3d4e5f6"] }), candidates as never);
    expect(out[0].publisher).toBe("The Verge");
  });

  // A candidate dropped in review leaves a citation pointing at nothing.
  it("keeps an id whose candidate is gone, rather than hiding the problem", () => {
    const out = citationsFor(line({ citations: ["000000000000"] }), candidates as never);
    expect(out[0]).toMatchObject({ id: "000000000000", missing: true });
  });
});
