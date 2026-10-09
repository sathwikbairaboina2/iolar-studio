import { BOOK_PAGES, TEMPLATES } from '../schema';
import { ICON_VOCAB } from '../renderer/icons';

/**
 * The one description of the post vocabulary every AI stage shares: plan, densify, fit,
 * headings and revise. Anything the renderer learns to draw is added here, and a test fails
 * if a diagram kind, list style or template is missing.
 */
export const SCHEMA_RULES = `Return ONLY a complete post JSON object (no prose, no markdown fences) with this exact shape:
{
  "brand": string, "template": one of [${TEMPLATES.map((t) => `"${t}"`).join(',')}],
  "ratio": "3:4", "seed": integer,
  "series": string (short series title, uppercase),
  "date": string (DD/MM/YYYY),
  "slides": [ Slide, ... ],
  "caption": { "text": string, "hashtags": [string, ...] }
}
Slide = {"page_title":string,"subtitle"?:string,"hero"?:IconName,"aside"?:string,"blocks":[Block,...]}
     | {"kind":"cover","page_title":string,"hero"?:IconName,"blocks":[],"cover":{"title":string,"subtitle"?:string,"tagline"?:string,"icons"?:[{"icon":IconName,"label":string,"sub"?:string}],"pills"?:[string]}}
"subtitle" is the smaller line after the title ("Identity and Access Management"); "hero" is the logo drawn top right of the page (the service's own icon, or "aws"); "aside" is a 2-4 word handwritten note (at most 40 characters) in the page corner, under the page number ("think B-tree!").
A cover slide is a whole page of its own (giant title, logo, tagline, an icon strip of 4-6 families, a pill list of names): use it as slide 1 when the series is a complete-notes style handbook.
Ink = "blue"|"red"|"green"|"black"|"accent"|"purple"|"orange"|"pink". Frame = "none"|"solid"|"dashed".
Block types (discriminated by "type"):
- {"type":"heading","text":string,"ink"?:Ink,"style"?:"ribbon"} ("ribbon" draws the text as a red-outlined banner label: "HOW IT WORKS")
- {"type":"concept","number":number,"title":string,"tagline"?:string} (a listicle page's opener: huge numeral "01" and the concept name on a highlighter band, a small hand aside as tagline)
- {"type":"labelrows","rows":[{"icon":IconName,"label":string,"text":string},...]} (1-4 rows: an icon in a ring, the label in red marker "What it is:", then one line of text)
- {"type":"paragraph","text":string,"frame"?:Frame,"ink"?:Ink}
- {"type":"bullets","items":[string,...],"style"?:"dot"|"number"|"check"|"cross"|"checkbox"|"star","frame"?:Frame,"ink"?:Ink}
- {"type":"sidebox","title":string,"items":[string,...],"ink"?:Ink}
- {"type":"table","headers":[string,...],"rows":[[string,...],...],"highlightRow"?:integer,"frame"?:Frame}
- {"type":"code","lang":string,"lines":[string,...],"note"?:string,"result"?:{"headers":[string,...],"rows":[[string,...],...]}} ("result" is what the code returns, drawn as a small table beside it; at most 4 rows)
- {"type":"callout","style":"tip"|"takeaway"|"cloud"|"sticky"|"sticky-pink"|"banner","title":string,"text":string} ("banner" is a full-width box with a lightbulb and a highlighted title: "INTERVIEW TAKEAWAY:")
- {"type":"qa","q":string,"a_bullets":[string,...],"example_code"?:[string,...]} (start q with "Q<n>. " and it becomes a numbered badge)
- {"type":"diagram","kind":"flow","spec":{"nodes":[string | {"text":string,"sub"?:string,"ink"?:Ink},...]}}
- {"type":"diagram","kind":"array","spec":{"cells":[string,...],"indices"?:boolean,"pointers"?:[{"index":integer,"label":string,"ink"?:Ink}],"highlight"?:[integer],"dim"?:[integer],"caption"?:string}}
- {"type":"diagram","kind":"flowchart","spec":{"title"?:string,"rows":[[nodeId,...],...],"nodes":{nodeId:{"text":string,"shape"?:"box"|"diamond"|"pill"|"icon","icon"?:IconName,"ink"?:Ink}},"edges":[{"from":nodeId,"to":nodeId,"label"?:string}]}}
  rows are top to bottom, 1-4 node ids per row, 1-7 rows; every edge endpoint must appear in rows. Nodes in one row are joined left to right.
  "shape":"icon" draws the icon with its caption and no box — the "service diagram": Application → RDS → two replicas, S3 → Lambda → DynamoDB. Give such a diagram a "title" ("RDS Architecture").
- {"type":"diagram","kind":"matrix","spec":{"rows":[[string,...],...],"highlight"?:[[row,col],...],"caption"?:string}}
- {"type":"diagram","kind":"cards","spec":{"cards":[{"title":string,"icon"?:IconName,"text"?:string,"lines"?:[string,...],"code"?:[string,...],"chain"?:[string,...],"ink"?:Ink},...]}} (2-6 cards in one row)
  icon cards = title + icon + one or two line "text" (the "Key Concepts" strip); "code" cards hold a short snippet; "chain" cards stack boxes with ↕ (tier architectures).
- {"type":"diagram","kind":"chain","spec":{"title"?:string,"steps":[{"text":string,"note"?:string,"ink"?:Ink},...]}} — vertical boxes with ↓ and a note beside each (key hierarchy, three levels).
- {"type":"diagram","kind":"tables","spec":{"tables":[{"title"?:string,"headers":[string,...],"rows":[[string,...],...],"caption"?:string},...],"arrow"?:boolean}} — 2-3 small example tables side by side, "arrow" for before → after.
- {"type":"diagram","kind":"schema","spec":{"tables":[{"name":string,"columns":[string,...]},...],"links":[{"from":name,"to":name,"fromLabel"?:string,"toLabel"?:string,"arrow"?:boolean}]}} — table boxes listing columns with "(PK)"/"(FK)", joined by lines labelled 1 / N.
- {"type":"diagram","kind":"er","spec":{"entities":[{"name":string,"attrs":[string,...],"key"?:string}],"relations":[{"from":name,"to":name,"name":string,"labels"?:[string,string]}]}} — ER diagram: entity boxes, attribute ovals, a relationship diamond with M/N labels.

ICONS AND LOGOS: IconName is any of ${ICON_VOCAB.slice(0, 70).map((n) => `"${n}"`).join(',')} … or any brand / AWS service / generic name written naturally ("Snowflake", "Node.js", "Amazon Redshift", "laptop") — the renderer finds the real logo. Put {icon:name} inline at the start of a list item or table cell ("{icon:ec2} **EC2** compute"); use "icon" fields on cards and flowchart nodes; use "hero" for the page's own logo.

INLINE MARKUP inside any text, item, cell or label (not in headings or code lines):
==term== yellow highlighter, **word** red emphasis, __word__ underline, \`x\` monospace, {green:word} / {blue:...} / {red:...} / {purple:...} / {orange:...} / {pink:...} coloured ink, {icon:name} a real logo or icon.
Use them the way a student does: highlight 1-3 key terms per block, put **...** on the one decisive word
(RIGHT, LEFT, sorted), underline the answer in a dry run. Never mark up whole sentences.

VOCABULARY RULES:
- "style":"number" for procedures and algorithm steps; "check" for prerequisites and "when to use"; "cross" for mistakes and anti-patterns; "checkbox" (☑) for key takeaways and best practices; "star" (☆) for use cases.
- "frame":"dashed" boxes a section body; give the box an "ink" that matches its meaning (green definition, red mistakes, blue complexity, purple template).
- "note" on code: the one gotcha next to the snippet, at most 8 words ("works only on SORTED arrays").
- "sticky" callouts for a pinned aside; "tip" and "takeaway" stay for boxed advice.
- "array" wherever indices or pointers are walked (low / mid / high); "flowchart" for any decision procedure; "cards" for an end-of-page summary strip; "matrix" for 2-D data; "flow" for a left-to-right pipeline.
- Dry runs are tables shaped Step | low | high | mid | arr[mid] | action, with "highlightRow" on the answer row.
- A service page pairs each section with its service diagram: bullets on one side, a titled "flowchart" of icon nodes beside it.
- Theory pages (databases, networks, OS): definition sections with pink dashed "Example :" boxes (frame dashed, ink pink), "schema" or "tables" diagrams for worked examples, a comparison table, and a "cloud" callout for the key rule.
- Code lines at most 34 characters so a snippet can sit inside a column; a longer line forces the block full width and a line over 80 is cut.

"page_title" is the section name ONLY — never write "Page 3:" or a page number in it; the template adds that.
Keep "page_title" under 42 characters and "subtitle" under 30 (a 2-4 word gloss): together they are one
headline line, and a longer pair wraps onto a second line and eats the page.

WRITE SHORT BLOCKS, MANY OF THEM. This is the single most important rule. Real study-notes
pages are dense because they carry MANY SMALL items, not a few long ones. A page is a
TWO-COLUMN grid holding about 70 short lines, and short blocks pair up side by side.

Per-block ceilings — treat these as hard:
- bullets: 3-5 items, each ONE line (max 12 words). Never a paragraph inside a bullet.
- paragraph: at most 2 short sentences. Prefer bullets; use paragraph sparingly.
- table: 3-5 rows, 2-4 columns, cells of 1-3 words. Terse ("O(1) avg", not "on average constant time").
- code: 3-6 lines, each under 34 characters, with a short trailing comment where it teaches something.
  Code must be valid in its language: a Dockerfile, JSON or INI takes comments only on a line of
  their own, never after an instruction. A comment that states an output, an inferred type or an
  error must be exactly what the real tool gives (TypeScript infers 'a', not string, for id('a')).
- sidebox / callout: title plus 2-4 one-line items.
- heading: a 2-5 word section label; number them (1., 2., 3. ...).
- array: at most 12 cells; flowchart: at most 12 nodes; cards: 2-4 cards of 2-3 lines.

Each block should render in about 4-6 lines. A block that runs past ~8 lines is too long —
split it into two blocks or cut words.

PER-SLIDE TARGET: 12-16 blocks, i.e. 4-6 numbered sections each followed by its bullets,
table, code or diagram. Fewer than 10 blocks means the page will render half empty.

SLIDE COUNT: about ${BOOK_PAGES} slides unless the book truly cannot fit. Divide the book's
points evenly — with N points that is about N/${BOOK_PAGES} points per slide, and each point
should become one short bullet, one table row, or one code line, NOT a paragraph.`;

export const RECIPE_GUIDANCE = `If the subject is an algorithm or coding pattern family, shape it the way an interview study sheet is shaped:
every pattern page carries, in order, a definition ("what is it"), the template code with a "note", a condition/action
table, a dry run table with the answer row highlighted, a visual walkthrough ("array" diagram with low/mid/high pointers),
and a "cross" list of common mistakes. The LAST slide is a revision sheet: a numbered list of the most-asked questions, a
decision "flowchart", a quick-reference table (pattern | goal | key update | return), a complexity table, and a "check"
list of when to use it. For other subjects, keep the same spirit: definition, mechanism, example, mistakes, summary.

If the subject is a platform or service family (AWS, Azure, Kubernetes, Docker): start with a cover slide (kind "cover": giant title, "hero" the platform logo, an icon strip of 4-6 service families with their real icons, a pill list of the main service names). Then one page per service family: title with a "subtitle" and the family's "hero" logo, one intro sentence, a "Key Concepts" strip of icon "cards", sections each paired with a titled icon "flowchart" service diagram, a comparison table, a "checkbox" list of key takeaways, a "sticky" tip.

If the subject is theory with worked examples (DBMS, SQL, networking): every page has a numbered title with a one-sentence intro carrying underlined keywords, definition sections with a pink dashed example box, "schema" / "tables" / "er" diagrams for the worked examples, a "chain" for hierarchies, a comparison table, and a "cloud" callout for the key rule or takeaway.`;

/** Every editing stage must carry the fields it does not touch: a revise that drops a hero or a card icon is a bug. */
export const PRESERVE_RULE = `PRESERVE EVERYTHING YOU DO NOT CHANGE. Every field on every slide and block you are not asked to edit
must come back exactly as it is: "hero", "subtitle", "kind", "cover", "frame", "ink", "style", "note", "highlightRow",
"icon", diagram "spec" objects, inline markers such as ==x== and {icon:name}. Never drop a field to simplify the JSON.`;
