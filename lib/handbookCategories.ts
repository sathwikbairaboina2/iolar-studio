/**
 * Handbook categories: one rule set per kind of carousel, read from the @abhi_techhub research
 * (docs/superpowers/specs/2026-10-06-handbook-categories-research.md). A category does not add
 * pipeline stages. The engine turns one book chapter into one page, so a category reshapes what
 * a chapter is (a topic, a page of questions, a concept, a subsystem, a task family) and feeds its
 * rules to the three prompts that matter: the book, each page, and the caption.
 *
 * Not to be confused with the app's top-level categories (handbooks, reels, jobs).
 */

import type { TEMPLATES } from './schema';

export type CategoryId = 'handbook' | 'interview-qa' | 'listicle' | 'system-design' | 'drills';

export type HandbookCategory = {
  id: CategoryId;
  name: string;
  emoji: string;
  /** One line for pickers and tooltips. */
  blurb: string;
  content: {
    /** What one book chapter (one page) holds. */
    unit: string;
    /** How the book prompt should cut the syllabus. */
    bookGuidance: string;
    /** Section roles every page carries, in order. */
    pageShape: string[];
    /** Accuracy and item rules. */
    rules: string[];
    /** What a count in the title ("10 …") counts: pages, items (book points), or nothing. */
    countBy: 'pages' | 'items' | 'none';
  };
  presentation: {
    /** The template family this category's pages are drawn in. */
    template: (typeof TEMPLATES)[number];
    itemsPerPage: string;
    /**
     * Book points one notebook page holds, and the chapters a book may have, for the book prompt's
     * SIZE budget. Calibrated on the round-4 rebuilds (see CAPACITY below): the global
     * POINTS_PER_PAGE / BOOK_PAGES in lib/ai/book.ts are study-sheet density and overfill these.
     */
    pointsPerPage: number;
    bookPages: number;
    /** Polish densifies pages under this fill. A page meant to breathe gets a lower target. */
    minFill: number;
    /** chapters: sections restart per page · continuous: items run on across pages · counter: one item per page, "02 / 12". */
    numbering: 'chapters' | 'continuous' | 'counter';
    pageRules: string;
    cover: string;
    closing: string;
  };
  script: {
    caption: string;
    /** Comment-gate call to action; {keyword} is filled with the chapter's keyword. */
    cta: string;
    /** Beat rules for a reel or explainer cut of this carousel. */
    narration: string[];
  };
};

/**
 * Round 4 (Sonnet, notebook template) measured points per rendered page, cover excluded, with the
 * old verbose page rules: api-questions 2.15, sql-drills 3.91, food-delivery 6.46, docker-handbook 5.97.
 * Handbook and system-design take 85% of theirs (polish adds content): 5 and 5. Q&A and drills are
 * item-counted (a title promises N questions or queries) and their pages were swollen by long answers,
 * so they keep 4 and (drills, once round 7 showed a full page holds 6 tasks) 6 and rely on the brevity rules in pageRules to fit.
 */
const NO_PADDING = 'Every item and page title is unique: never repeat a topic to reach a count. If the title promises N, deliver exactly N.';
const COVER_FROM_PAGES = 'The cover lists only what the pages actually deliver, in page order.';
const NO_PAGE_REFS = 'Never point to a page number ("see p.4"): page numbers change when parts split.';

export const CATEGORIES: HandbookCategory[] = [
  {
    id: 'handbook',
    name: 'Complete Handbook',
    emoji: '📘',
    blurb: 'A topic deep dive: one chapter per page, dense study notes, cheat sheet at the end.',
    content: {
      unit: 'one topic chapter',
      bookGuidance: 'Cut the topic into chapters from fundamentals to production: concepts, internals, practical usage, comparisons, trade-offs, common mistakes. Each chapter is one page of about 5 specific points. At most ONE intro page, and at most ONE closing page (the cheat sheet).',
      pageShape: ['definition', 'mechanism', 'comparison', 'example', 'mistakes', 'summary'],
      rules: [NO_PADDING, NO_PAGE_REFS, 'Each page carries an "Interview Point" with 2-4 questions an interviewer would ask about it.'],
      countBy: 'none',
    },
    presentation: {
      template: 'notebook',
      itemsPerPage: '6-8 numbered sections',
      // Quick revision: a chapter is about 6 short pages of 5 points, so the book is at most 30 points.
      pointsPerPage: 5,
      bookPages: 6,
      minFill: 85,
      numbering: 'chapters',
      pageRules: 'Page title plus a one-line scope subtitle. At most 8 numbered sections per page (bullets at most 12 words), mixing definition bullets, one X-vs-Y comparison table, one flow diagram and one code or pseudo-code example. Every page carries one colour-coded table (a meaning per column or row, shown in colour) and, where the topic has code, one annotated code example: a "code" block whose "note" names the gotcha. Close the page with a one-line "Key Takeaways" callout.',
      cover: `A cover with the handbook title, "From Basics to Advanced", and a numbered "What you'll learn" list. ${COVER_FROM_PAGES}`,
      closing: 'The last page is a summary and cheat sheet: a recap table, the most-asked interview questions, next steps.',
    },
    script: {
      caption: 'Hook first, naming the outcome ("Everything you need before your <topic> interview", the topic from the title). Then a "Topics covered" tick list that matches the page titles exactly, and who it is for.',
      cta: 'Comment “{keyword}” and I’ll send you the full PDF.',
      narration: ['Hook in the first 2 seconds: the problem this topic solves.', 'One beat per page: its title plus the single takeaway.', 'Say only what the page shows.', 'End on the cheat sheet and the CTA.'],
    },
  },
  {
    id: 'interview-qa',
    name: 'Interview Q&A Bank',
    emoji: '🎯',
    blurb: 'Numbered interview questions, run on across pages: question, short answer, key points, visual.',
    content: {
      unit: 'one page of 4 questions on one theme',
      bookGuidance: 'Cut the topic into themed pages of 4 interview questions each, ordered from fundamentals to advanced and scenario questions. Each point IS one question, phrased exactly as asked ("What is the difference between X and Y?"). Title each chapter with its theme. At most ONE intro page, and at most ONE closing page. The first chapter is the cover: shape ["cover"], its points are what the cover lists; it is not counted as an item.',
      pageShape: ['question', 'short answer', 'key points', 'visual'],
      rules: [NO_PADDING, NO_PAGE_REFS, 'Each answer: a 1-2 sentence direct answer, 2-4 "Key points" bullets, and a diagram, table, formula or code snippet where it helps.', 'Questions are the ones interviewers actually ask, not textbook headings.'],
      countBy: 'items',
    },
    presentation: {
      template: 'notebook',
      itemsPerPage: '4 questions',
      pointsPerPage: 4,
      // A bank promises its count ("50 questions"): 13 question pages plus a cover and a closing
      // page. Twelve pages capped the book at 48 and fought the count gate.
      bookPages: 16,
      minFill: 80,
      numbering: 'continuous',
      pageRules: 'Every question is ONE "qa" block, which keeps the question and its answer together: q is "Q<n>. <question>", numbering running on from the previous page (the "Q<n>. " prefix is drawn as a red number badge), a_bullets open with the answer, ONE sentence, then at most 3 key points of at most 10 words each; example_code holds a short snippet when code helps. Exactly 4 questions per page (4 questions per page is the count, whatever the answer length), each with at most one small table, diagram or 4-line code block. At most 9 blocks per page. No headings between questions. When space allows, close the page with a "callout" of style "banner" titled "Key takeaways".',
      cover: `A cover stating the question count and the themes covered, with who it is for. ${COVER_FROM_PAGES}`,
      closing: 'The last page is a quick-revision table of the most important answers and the top 5 must-know questions.',
    },
    script: {
      caption: 'Hook with the count and the interview ("<count> <topic> questions they will ask you", <count> the number in the title, never another). List the themes, then ask which question they find hardest.',
      cta: 'Comment “{keyword}” to get all the answers as a PDF.',
      narration: ['Hook: the hardest question in the set, asked to camera.', 'One beat per page: read 1-2 questions and the one-line answers.', 'Say only what the page shows.', 'End with the count and the CTA.'],
    },
  },
  {
    id: 'listicle',
    name: 'N Concepts Listicle',
    emoji: '🔢',
    blurb: '"10 X you can’t skip": one concept per page on a fixed template, big type, phone-readable.',
    content: {
      unit: 'one concept',
      bookGuidance: 'Pick the N concepts a developer must know for this topic: distinct, no overlaps, no near-duplicates, ordered from foundational to advanced. One chapter per concept, titled with the concept name. Its points are exactly: what it is; why it exists; used for; how it works (one worked example); 2-4 benefits; 2-4 things to consider; the interview takeaway. At most ONE intro page, and at most ONE closing page. The first chapter is the cover: shape ["cover"], its points are what the cover lists; it is not counted as an item.',
      pageShape: ['what it is', 'why it exists', 'used for', 'how it works', 'benefits', 'things to consider', 'interview takeaway'],
      rules: [NO_PADDING, NO_PAGE_REFS, 'Concepts must be distinct: two names for one idea (Decision Tree and Decision Trees) count as a duplicate.', 'The worked example is concrete: real values, a real table, a real query.'],
      countBy: 'pages',
    },
    presentation: {
      template: 'notebook',
      itemsPerPage: '1 concept',
      pointsPerPage: 7,
      bookPages: 12,
      minFill: 60,
      numbering: 'counter',
      pageRules: 'Fixed template, in this block order: (1) a "concept" block (its number in the list, and its name); (2) a "labelrows" block with exactly three rows, "What it is:", "Why it exists:" and "Used for:", each with a fitting icon and a text of at most 12 words; (3) a "heading" block with style "ribbon" and the text "How it works", then ONE diagram or table worked example (one only) with real values; (4) two framed "bullets" blocks, "Benefits" with style "check" and "Things to consider" with style "cross" (2-4 items each, ticks and crosses; frame "solid" with a green and a red ink); (5) a "callout" of style "banner" titled "Interview takeaway:" with two lines. At most 7 blocks. Set the slide "aside" to a 2-4 word hand note. Larger text and fewer, bigger blocks than a handbook page.',
      cover: `A poster cover: the big number, the promise ("You Can’t Skip in System Design Interviews"), three ticks. ${COVER_FROM_PAGES}`,
      closing: 'No separate closing page: the last concept ends the post.',
    },
    script: {
      caption: 'Hook with the number and the stakes. Then a numbered list of the N concepts exactly as titled, and a question: which one confuses you most?',
      cta: 'Comment “{keyword}” and save this for your next interview.',
      narration: ['Hook: the number and why skipping these costs you.', 'One beat per concept: name, what it is, the takeaway, in under 6 seconds.', 'Say only what the page shows.', 'End with the CTA.'],
    },
  },
  {
    id: 'system-design',
    name: 'System Design Case Study',
    emoji: '🏗️',
    blurb: 'Design a real product (Zomato, BookMyShow): requirements, then one subsystem per page.',
    content: {
      unit: 'one subsystem',
      bookGuidance: 'Design the named product end to end. First chapters: problem statement and scope; functional and non-functional requirements with scale estimates; high-level architecture. Then one chapter per core subsystem (for example order, payment, search, notifications, tracking). Last chapter: scaling, failure handling, trade-offs and interview questions. Every subsystem chapter covers its responsibilities, design, data model, APIs, the main flow, failure scenarios and metrics. At most ONE intro page (problem, scope and requirements together), and at most ONE closing page. The first chapter is the cover: shape ["cover"], its points are what the cover lists; it is not counted as an item.',
      pageShape: ['responsibilities', 'high level design', 'state or sequence flow', 'data model', 'apis', 'failure scenarios', 'metrics'],
      rules: [NO_PADDING, NO_PAGE_REFS, 'Name the running example in every page subtitle, e.g. "(Food Delivery App)".', 'Numbers are explicit estimates (QPS, storage, latency targets), never "a lot".'],
      countBy: 'none',
    },
    presentation: {
      template: 'notebook',
      itemsPerPage: 'at most 8 numbered sections',
      pointsPerPage: 5,
      bookPages: 12,
      minFill: 85,
      numbering: 'chapters',
      pageRules: 'Subsystem pages carry at most 8 numbered sections (bullets at most 12 words); merge neighbours (events into APIs, metrics into failure scenarios) rather than add a ninth. The full set, in this order: Responsibilities; High Level Design; the state machine; table schema; key APIs; idempotency and consistency; failure scenarios; events published; key metrics; design considerations. Draw High Level Design as a titled "flowchart" with icon nodes. Draw the state machine as a "flowchart" with one node per state and one edge per transition, never text arrows in a bullet. The table schema is a "table" of column, type, description. Failure scenarios, events and metrics are short bullets; design considerations are ticks ("check" bullets). Page title is the subsystem; the subtitle names the running example. Intro pages (problem, requirements, scale) keep their own shape.',
      cover: `A poster cover with the product, "Design a scalable …", and a tick list of what is covered. ${COVER_FROM_PAGES}`,
      closing: 'The last page: best practices, the trade-offs table, the tech stack, and the interview questions to expect.',
    },
    script: {
      caption: 'Hook with the interview prompt ("How would you design <the system> for millions of users?", the system from the title). Then the subsystems covered, in page order.',
      cta: 'Comment “{keyword}” to get the full system design PDF.',
      narration: ['Hook: the interview prompt as a question.', 'One beat per subsystem: its job and the one design decision that matters.', 'Say only what the page shows.', 'End on the trade-offs and the CTA.'],
    },
  },
  {
    id: 'drills',
    name: 'Query & Code Drills',
    emoji: '🧪',
    blurb: 'Numbered practice tasks with the solution and its output: "300 SQL queries".',
    content: {
      unit: 'one task family (8-12 tasks)',
      bookGuidance: 'Cut the topic into task families ordered from basic to advanced (for SQL: basics, filtering, aggregates, joins, subqueries, window functions, CTEs, real interview scenarios). Each point IS one task, phrased as an instruction ("Find employees earning more than their manager"). Cover every family the title promises; never fill pages with one family. At most ONE intro page: the whole schema with its sample rows on one page, never separate data-loading pages. The book also carries one shared "dataset" (every table and sample row the tasks use), so no page invents data of its own. At most ONE closing page. The first chapter is the cover: shape ["cover"], its points are what the cover lists; it is not counted as an item.',
      pageShape: ['task', 'solution code', 'result'],
      rules: [NO_PADDING, NO_PAGE_REFS, 'Every solution must run as written on the stated engine and version.', 'Every result shown is what that code actually returns on the sample data.'],
      countBy: 'items',
    },
    presentation: {
      template: 'notebook',
      itemsPerPage: '5-6 tasks',
      pointsPerPage: 6,
      bookPages: 12,
      minFill: 80,
      numbering: 'continuous',
      pageRules: 'Page title names the family and its range ("JOIN Queries (Q61-75)"). 5-6 tasks per page. Every task is a "heading" "Q<n>. <short task title>" in sentence case (task title at most 6 words), numbering running on from the previous page, followed by ONE "code" block, code at most 6 lines, that carries a "result": the rows the query returns on the sample data, at most 3 rows and 3 columns. No sticky notes. When space allows, close the page with a "callout" of style "banner" titled "Key takeaways:".',
      cover: `A cover with the task count, the engine, and the families covered. ${COVER_FROM_PAGES}`,
      closing: 'The last page recaps the patterns used, as a table of pattern and when to use it.',
    },
    script: {
      caption: 'Hook with the count and the outcome ("<count> SQL queries to crack any data interview", <count> the number in the title, never another). List the families, in page order.',
      cta: 'Comment “{keyword}” to get every query and answer as a PDF.',
      narration: ['Hook: one tricky task, asked to camera.', 'One beat per page: the family and one task solved.', 'Say only what the page shows.', 'End with the count and the CTA.'],
    },
  },
];

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function isCategoryId(id: unknown): id is CategoryId {
  return typeof id === 'string' && BY_ID.has(id as CategoryId);
}

/** A chapter with no category, or one this build does not know, is a classic handbook. */
export function categoryOf(id: unknown): HandbookCategory {
  return BY_ID.get(id as CategoryId) ?? CATEGORIES[0];
}

/** A cover chapter lists what is inside; it is never an item and never counted. */
export const isCover = (c: { shape?: string[] }) => Boolean(c.shape?.includes('cover'));

/** A cover whose points are all short labels (six words or fewer) has nothing to teach; a longer one is a teaching section. */
export const isLabelCover = (c: { shape?: string[]; points: string[] }) => isCover(c) && c.points.every((p) => p.trim().split(/\s+/).length <= 6);

/** Roles only a closing page plays. */
const CLOSING_ROLES = new Set(['cheatsheet', 'cheat sheet', 'summary', 'recap']);

/**
 * An item page carries the category's template: a concept, a page of questions, a subsystem. A
 * cover, an intro or a closing page does not, and is not counted. A chapter with no shape, or one
 * sharing at least half the template's roles, is an item.
 */
export function isItemChapter(category: unknown, c: { shape?: string[] }, book?: { shape?: string[] }[]): boolean {
  if (isCover(c)) return false;
  if (!c.shape?.length) return true;
  const roles = new Set(categoryOf(category).content.pageShape);
  const shared = c.shape.filter((r) => roles.has(r)).length;
  // A book that wrote its own role names (a listicle's "definition", "mechanism") shares none anywhere:
  // then the vocabulary says nothing, and a chapter is an item unless it closes the book. (Where
  // other chapters do share roles, a chapter that shares none is an intro and stays one.)
  if (!shared && book && !book.some((o) => o.shape?.some((r) => roles.has(r)))) return !c.shape.every((r) => CLOSING_ROLES.has(r));
  return shared * 2 >= roles.size;
}

/** The 1-based item numbers a page carries when numbering runs on: items on earlier pages + 1 … */
export function itemRange(book: { chapters: { points: string[]; shape?: string[] }[] }, index: number): { from: number; to: number } {
  const before = book.chapters.slice(0, index).filter((c) => !isCover(c)).reduce((n, c) => n + c.points.length, 0);
  return { from: before + 1, to: before + book.chapters[index].points.length };
}

export type ChapterFilter = { category?: string; status?: string; query?: string };

/** The subject page's list filters. A chapter without a category counts as a handbook. */
export function filterChapters<T extends { title: string; category?: string; status?: string }>(list: T[], f: ChapterFilter): T[] {
  const q = f.query?.trim().toLowerCase();
  return list.filter((c) =>
    (!f.category || categoryOf(c.category).id === f.category) &&
    (!f.status || c.status === f.status) &&
    (!q || c.title.toLowerCase().includes(q)));
}
