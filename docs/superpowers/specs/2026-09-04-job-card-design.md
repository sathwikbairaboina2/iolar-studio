# Job card — one job, one post

A reel speaks for a whole week of roles. A job card speaks for one. The Jobs page
already turns a period's rows into a reel through the jobs-reel plugin; this is the
other half — a single opening rendered as an image ready to post.

## What goes in

Two ways in, one document out.

- **A job URL.** The studio fetches the page, and the local model reads it into a
  JobCard.
- **A pool row.** The row already in `jobs_pool` maps straight across; the model
  fills only what the row cannot say (eligibility, selection process).

A **reference post** — an Instagram URL, or a shortcode instascraper already holds
on `:3000` — never supplies the facts. It supplies the look, and per post the user
picks which of two ways:

- **match style** — a vision pass reads the reference into a style profile
  (family, accent, density, badge, photo) and that profile chooses one of our
  families;
- **clone layout** — a vision pass reads the reference into a layout and the card
  is built to mirror it, with the new job's content.

Neither works until a vision model is installed; see Open items.

## The document

`lib/jobcard/schema.ts` holds `JobCardSchema`. Seven fields are mandatory and the
renderer refuses a document missing any of them — the UI names what is missing
rather than rendering a card with a hole in it.

| field | shape | mandatory |
|---|---|---|
| `company` | `{ name, logo?, accent? }` | yes |
| `role` | `{ title, skills[] }` | yes (`skills` is the mandatory *skill*) |
| `experience` | `{ min?, max?, label }` | yes |
| `location` | `{ city, region?, workMode }` | yes |
| `salary` | `{ min, max, currency, unit, note? }` | yes |
| `eligibility` | `string[]` | yes |
| `selectionProcess` | `{ step, label, detail? }[]` | when the source says so |
| `dates` | `{ kind, date, time? }[]` | no |
| `cta` | `{ keyword, channel }` | no — defaults from company name |
| `source` | `{ url, kind }` | yes |

`selectionProcess` is mandatory *if available*: absent from the source it is
absent from the card, and the families that show it fall back to their alternate
block rather than printing an empty panel.

## The families

Six, all light. Each is a directory under `templates/_jobcard/` holding
`template.html` and `manifest.json`. The leading underscore keeps them out of
`builtTemplates()` and out of the carousel template contract test — a job card is
not a handbook page and shares none of that machinery.

| family | ratio | picked when |
|---|---|---|
| `split-hero` | 3:4 | one role, few facts, a company visual exists |
| `infographic` | 4:5 | several requirements and no usable image |
| `campaign` | 3:4 | a drive or walk-in with dates and a selection process |
| `bento` | 4:5 | facts are short and of equal weight |
| `ticket` | 3:4 | one role with a deadline |
| `band-stack` | 3:4 | nothing may be cut — the safe default |

They share one slot vocabulary, so the same document fills any of them: `logo`,
`headline`, `badge`, `rolePill`, `factRows`, `ribbon`, `requirementRows`, `panel`,
`highlightBox`, `chips`, `watermark`, `footerCta`. A family uses the slots it has a
place for and ignores the rest. Shared CSS lives in `templates/_jobcard/_shared/`;
each family's own rules sit in its `template.html`.

Colour follows one rule per card: a single **accent** taken from the company, a
**navy** derived from it, a fixed four-colour icon-coin palette that never changes,
and yellow reserved for exactly one word — the comment keyword.

## Choosing a family

`lib/jobcard/pick.ts` scores the document: how many facts it has, whether dates
exist, whether a selection process exists, whether a logo image was found. The
score picks a family and the model may override it. A picked family that cannot
hold the document — text overflows its box — falls back to `band-stack`, which
gives every field its own row and cannot overflow the way a fixed panel can.

## Rendering

`lib/jobcard/render.ts` mirrors `lib/renderer/capture.ts`: build the HTML, write it
beside its template so relative paths resolve, screenshot it in the chromium
Playwright already launches, and check the result did not overflow. Sizes are
1080×1440 for 3:4 and 1080×1350 for 4:5, rendered at twice that and downsampled by
sharp, exactly as slides are.

Fonts are bundled, not fetched: Montserrat 700/800 for headlines and Inter
400/600/700 for everything else, under `templates/_jobcard/_shared/fonts/`.

## The logo must be real

In order: the `og:image` or a large icon on the job page; the logo cropped from the
reference post; a web search through the research service; and only then a wordmark
set in heavy type. A wordmark is a real fallback, not a placeholder — what is never
allowed is a made-up mark.

## Where it lives

- `POST /api/jobcards` — a URL or a pool row in, a document out.
- `GET|PUT /api/jobcards/{id}` — read and edit the document.
- `POST /api/jobcards/{id}/render` — a family and a ratio in, a PNG out.
- `GET /api/jobcards/{id}/image` — the rendered card.

Documents and images live under `data/jobcard/<id>/`, with a `jobcards` table in
the jobs ledger holding the row. The Jobs page's **Job card** tab is the whole
surface: paste, analyse, correct the document, pick a family, render, copy the
caption.

## Testing

Schema tests for the mandatory gate. Extractor tests against saved job pages, so
no test needs the network. A render test per family that asserts the card did not
overflow and that every mandatory field appears in the HTML. A page test for the
tab.

## Open items

- **No vision model is installed.** Ollama on `:11436` holds text models and an
  embedder. Both reference-post paths need one pulled — `qwen2.5vl:7b` is the
  candidate. Everything else works without it, so the reference input ships
  disabled with a clear reason.
- Caption generation reuses the reel writer's tone; it is written after the first
  cards render, not before.
