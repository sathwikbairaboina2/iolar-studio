# Content Verification & Review Agent — Design

**Date:** 2026-08-29
**Status:** Approved design, pending implementation plan
**Builds on:** `2026-08-29-instastudio-handbooks-design.md`

## 1. Problem

Nothing verifies what we publish. An audit of the seven generated chapters found:

- **13 of 94 Python snippets fail to parse (14%).** Several are genuinely broken, not stylistic: `python/generators` p3 begins at `def __next__(s):` with the class header missing; `python/decorators` p10 has a `def` with no body followed by an orphaned `except ValueError`; `python/decorators` p6 defines `repeat` twice in one block.
- **Dropped points skew toward caveats.** Coverage is 97–100%, but what falls out is disproportionately safety material — the caching chapter lost "caches keyed on user-controlled input can leak data across users", the rate-limiting chapter lost the `X-Forwarded-For` spoofing warning.
- **Four duplicate headings** inside a single part.
- **No factual checking at all.** No complexity, API name or semantic claim is compared against anything.
- **Two data-hygiene bugs:** stale `render-report.json` rows inflate page counts and skew average fill (`python/data-structures` reports 30 pages at 77%); chapter status reads `draft` when part 1 is fully rendered because status takes the weakest part.

## 2. Approach

Three layers, cheapest first.

1. **Deterministic gates** run on every render. No AI, no network. They catch mechanical defects and block packaging.
2. **The review agent** runs on demand against a finished part, in seven independent passes, and reports findings. It never edits.
3. **A publish gate**: `published` is reachable only when gates pass and no blocker-severity finding is open.

## 3. Schema change

`code` blocks gain one optional field:

```ts
{ type: 'code', lang: string, lines: string[], runnable?: boolean }
```

- `runnable: true` — a complete program. Parsed **and executed**; any `# → value` or `# value` output comment on the last expression is asserted against real stdout.
- `runnable: false` or absent — an illustrative fragment (`@repeat(3)` / `def f(): ...`). Parsed leniently: a fragment may fail to compile, but must not contain the *broken* signatures below.

The planner is told to set `runnable: true` whenever a snippet is self-contained, which is most of them.

### Broken-code signatures (blocking regardless of `runnable`)

- a `def`/`class` header whose body is missing (next non-blank line dedents or the block ends)
- a block whose **first** line is indented (a severed class or function body)
- an `except`/`else`/`elif`/`finally` with no matching opener in the same block
- the same identifier defined twice at top level within one block

## 4. Deterministic gates

`lib/verify/gates.ts` exports `runGates(subject, chapter, part): Promise<Finding[]>`:

| Gate | Rule | Severity |
|---|---|---|
| `code.parse` | broken-code signatures above | blocker |
| `code.execute` | `runnable` block must exit 0 within 5s, no network, and match its output comment | blocker on crash, major on output mismatch |
| `table.shape` | every row's width equals the header width | blocker |
| `heading.unique` | no repeated heading text within one part | major |
| `coverage.points` | every book point covered; a point matching `/security|leak|spoof|inject|auth|escape|sanitiz|overflow|race/i` counts double | blocker for caveats, major otherwise |
| `page.fill` | no page under 70% fill, none overflowing | major |
| `brand.shape` | brand handle matches settings; caption non-empty; 5–15 hashtags | minor |

Execution sandbox: `python -I -S` in a subprocess with `cwd` set to an empty temp dir, `PYTHONPATH` cleared, a 5-second timeout, output capped at 8 KB, and `HTTP_PROXY`/`HTTPS_PROXY` pointed at an unreachable address so a snippet cannot reach the network. Only `lang` values `python`/`py` execute; other languages parse-only.

## 5. Review agent

`lib/verify/review.ts` exports `reviewPart(subject, chapter, part): Promise<Review>`.

```ts
type Severity = 'blocker' | 'major' | 'minor';
type Finding = {
  pass: string;          // 'facts' | 'code' | 'coverage' | 'visual' | 'pedagogy' | 'originality' | 'brand'
  severity: Severity;
  page: number;          // 1-based; 0 = whole part
  block?: number;        // 0-based index within the page
  summary: string;       // one sentence, the defect
  evidence: string;      // the quoted text or measurement it rests on
  fix: string;           // concrete suggested change
};
type Review = { generatedAt: string; part: number; findings: Finding[]; passed: boolean };
```

Seven passes, run concurrently, merged in severity order:

| Pass | Method |
|---|---|
| `facts` | Claude with `WebSearch`; every factual claim extracted and checked; only contradicted claims are reported |
| `code` | the deterministic gate results, re-labelled as findings |
| `coverage` | deterministic book-point comparison |
| `visual` | Claude reads the rendered PNGs; looks for text cut at the page edge, overlapping frames, unreadable contrast |
| `pedagogy` | Claude over the page sequence; wrong order, undefined jargon, a page that assumes a later page |
| `originality` | graph `shares_topic` neighbours plus text overlap; flags a chapter rehashing another |
| `brand` | deterministic shape checks plus a Claude read of the caption |

`passed` is true when no blocker remains. Reviews persist to `parts/<NN>/review.json`.

## 6. Publish gate

`partStatus` gains `published`, reachable only when `review.json` exists, is newer than `post.json`, and has `passed: true`. `packagePost` refuses when a blocker is open, with the finding in the error. Chapter status reports **per part** rather than collapsing to the weakest.

## 7. Data hygiene

- `render-report.json` is rewritten wholesale on a full render rather than merged, so stale rows cannot survive.
- `loadChapterMeta` counts pages from the report's current entries only.

## 8. UI

A **Review** tab beside the page preview in the chapter editor:

- a run button, a pass/fail banner, and findings grouped by severity
- each finding shows page, evidence and suggested fix; clicking it selects that page
- **Fix with AI** routes the finding through the existing revise diff-approve path, so a fix may only add or correct — the never-trim guards stay in force
- re-running review after a fix updates the banner

## 9. Testing

- **Gates**: fixtures for each broken-code signature (severed body, indented first line, orphaned `except`, duplicate definition), a ragged table, a duplicate heading, a dropped security point, an under-filled page. Each asserts the exact finding and severity.
- **Sandbox**: a snippet printing the expected value passes; one that loops forever times out and reports; one attempting a socket connection fails without hanging.
- **Review**: with Claude mocked, seven passes merge into one ordered list, `passed` reflects blockers, and `review.json` is written.
- **Publish gate**: packaging refuses while a blocker is open and succeeds once cleared.
- The existing 108 tests stay green.

## 10. Out of scope

- Auto-applying fixes without approval
- Reviewing an entire chapter's parts in one call (per-part only)
- Non-Python execution (parse-only for other languages)
- Human annotation or review history beyond the latest run

## 11. Decisions log

| Decision | Choice |
|---|---|
| Fragments vs programs | explicit `runnable` flag; fragments parse-leniently but must not be broken |
| Where execution happens | sandboxed subprocess, no network, 5s timeout |
| Agent authority | reports only; fixes go through the existing diff-approve path |
| Caveat points | security/safety points are blocking when dropped |
| Publish | gated on passing review, not merely on files being written |
