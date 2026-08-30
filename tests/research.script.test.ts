import { describe, it, expect } from 'vitest';
import { parseScript, plainScript, unsupportedClaims, mergeLineEdits } from '@/lib/reel/research/script';

/**
 * The script is the workflow's deliverable, so its shape is load-bearing:
 * concatenating the lines has to yield a plain script, and the link between a
 * claim and the source that proved it has to survive to the end.
 */

const line = (over: Record<string, unknown> = {}) => ({
  id: "l1",
  order: 0,
  role: "hook",
  text: "xAI just gave its agents their own computer.",
  citations: ["a1b2c3d4e5f6"],
  assetIds: [],
  note: null,
  ...over,
});

const valid = {
  runId: "ltx-video-open-weights-20260830-2140",
  createdAt: "2026-08-30T21:40:00.000Z",
  updatedAt: "2026-08-30T21:40:00.000Z",
  status: "draft",
  lines: [line(), line({ id: "l2", order: 1, role: "body", text: "Every call opens a fresh box." })],
  unsupported: [],
};

describe("parseScript", () => {
  it("accepts a valid script", () => {
    expect(parseScript(valid).lines).toHaveLength(2);
  });

  it("names the missing field", () => {
    const { status, ...rest } = valid;
    expect(() => parseScript(rest)).toThrow(/status/);
  });

  it("rejects a candidate id that is not a candidate id", () => {
    expect(() => parseScript({ ...valid, lines: [line({ citations: ["nope"] })] })).toThrow(/citations/);
  });

  it("rejects an unknown role", () => {
    expect(() => parseScript({ ...valid, lines: [line({ role: "outro" })] })).toThrow(/role/);
  });

  it("rejects an empty line, since a silent line is a mistake not a choice", () => {
    expect(() => parseScript({ ...valid, lines: [line({ text: "  " })] })).toThrow(/text/);
  });

  it("rejects two lines sharing an id, which would break edit merging", () => {
    expect(() => parseScript({ ...valid, lines: [line(), line({ order: 1 })] })).toThrow(/id/);
  });

  it("rejects duplicate order values", () => {
    expect(() => parseScript({ ...valid, lines: [line(), line({ id: "l2" })] })).toThrow(/order/);
  });

  it("allows an uncited line only when it is marked commentary", () => {
    const commentary = line({ citations: [], commentary: true });
    expect(parseScript({ ...valid, lines: [commentary] }).lines[0].commentary).toBe(true);
  });

  it("defaults commentary to false", () => {
    expect(parseScript(valid).lines[0].commentary).toBe(false);
  });
});

describe("plainScript", () => {
  it("concatenates the lines in order, which is what the reel planner consumes", () => {
    const script = parseScript({
      ...valid,
      lines: [line({ id: "b", order: 1, text: "Second." }), line({ id: "a", order: 0, text: "First." })],
    });

    expect(plainScript(script)).toBe("First.\nSecond.");
  });

  it("survives a single line", () => {
    expect(plainScript(parseScript({ ...valid, lines: [line({ text: "Only." })] }))).toBe("Only.");
  });
});

describe("unsupportedClaims", () => {
  it("names a brief claim no line covers", () => {
    const out = unsupportedClaims(["agents get their own computer", "it runs on device"], [
      line({ text: "xAI gave its agents their own computer." }),
    ] as never);

    expect(out).toEqual(["it runs on device"]);
  });

  it("counts a claim as covered when the wording overlaps enough", () => {
    const out = unsupportedClaims(["agents get their own computer"], [
      line({ text: "Each agent now gets its own computer to work in." }),
    ] as never);

    expect(out).toEqual([]);
  });

  it("does not count an uncited line as proof of anything", () => {
    const out = unsupportedClaims(["it runs on device"], [
      line({ text: "It runs on device.", citations: [], commentary: true }),
    ] as never);

    expect(out).toEqual(["it runs on device"]);
  });

  it("returns every claim when there are no lines yet", () => {
    const claims = ["agents get their own computer", "it runs on device"];
    expect(unsupportedClaims(claims, [])).toEqual(claims);
  });

  it("reports a claim with nothing matchable in it rather than passing it", () => {
    expect(unsupportedClaims(["a of the"], [line() as never])).toEqual(["a of the"]);
  });
});

describe("mergeLineEdits", () => {
  it("keeps a hand-edited line when the script is redrafted", () => {
    const edited = [line({ id: "l1", text: "My own wording." })];
    const redrafted = [line({ id: "l1", text: "The model's wording." }), line({ id: "l2", order: 1 })];

    const out = mergeLineEdits(redrafted as never, edited as never);

    expect(out[0].text).toBe("My own wording.");
    expect(out).toHaveLength(2);
  });

  it("takes new citations even for a line whose text was edited", () => {
    const edited = [line({ id: "l1", text: "Mine.", citations: ["a1b2c3d4e5f6"] })];
    const redrafted = [line({ id: "l1", text: "Theirs.", citations: ["f6e5d4c3b2a1"] })];

    const out = mergeLineEdits(redrafted as never, edited as never);

    expect(out[0].text).toBe("Mine.");
    expect(out[0].citations).toEqual(["f6e5d4c3b2a1"]);
  });

  it("drops a line the user removed rather than resurrecting it", () => {
    const redrafted = [line({ id: "l1" }), line({ id: "l2", order: 1 })];

    const out = mergeLineEdits(redrafted as never, [line({ id: "l2", order: 1 })] as never, ["l1"]);

    expect(out.map((l) => l.id)).toEqual(["l2"]);
  });
});
