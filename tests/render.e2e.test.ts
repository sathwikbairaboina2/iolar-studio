import { describe, it, expect, afterAll } from 'vitest';
import { renderSlide, renderAll, balanceTail, closeBrowser, TAIL_FLOOR } from '@/lib/renderer/capture';
import { validatePost, Post } from '@/lib/schema';
import path from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';
import sharp from 'sharp';

function makePost(template: string): Post {
  return validatePost({
    brand: 'iolar', template, ratio: '3:4', seed: 7,
    series: 'RENDER TEST', date: '29/08/2026',
    slides: [{
      page_title: 'SMOKE', blocks: [
        { type: 'heading', text: '1. Hello render' },
        { type: 'bullets', items: ['one', 'two'] },
        { type: 'table', headers: ['A', 'B'], rows: [['1', '2']] },
        { type: 'qa', q: 'What is Python?', a_bullets: ['high-level', 'interpreted'], example_code: ['x = 10  # int'] },
      ],
    }],
    caption: { text: '', hashtags: [] },
  });
}

afterAll(async () => { await closeBrowser(); });

describe('a part that flows onto a starved last page', () => {
  it('pushes blocks back until the tail is a real page', async () => {
    // Just over one page of content: the flow fills page 1 and drops the remainder on page 2.
    const post = validatePost({
      brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 7,
      series: 'TAIL TEST', date: '08/09/2026',
      slides: [{
        page_title: 'ONE AND A BIT',
        blocks: Array.from({ length: 26 }, (_, i) => ({
          type: 'bullets',
          items: [`point ${i} carrying a line of real length`, 'a second line of the same', 'and a third'],
        })),
      }],
      caption: { text: '', hashtags: [] },
    });
    const dir = path.join(tmpdir(), `iolar-test-tail-${Date.now()}`);
    const { results } = await renderAll(post, dir);
    expect(results.length).toBe(2);
    const [first, last] = results;
    // The content is only about 1.3 pages, so neither page can reach the floor — what the
    // rebalance owes us is that the deficit is shared, not dumped on a scrap last page.
    expect(last.fillPct).toBeGreaterThan(55);
    expect(Math.abs(first.fillPct - last.fillPct)).toBeLessThanOrEqual(8);
    expect(TAIL_FLOOR).toBe(80);
    for (const r of results) expect(r.overflowPx).toBe(0);
  });
});

describe('balancing a starved tail', () => {
  it('never leaves the page before it ending on a heading', async () => {
    // The layout binds a heading to the block after it, but only within one page. Moving
    // just the table to the tail used to leave its heading last on the page above, alone.
    const post = validatePost({
      brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 7,
      series: 'TAIL HEADING', date: '25/09/2026',
      slides: [
        { page_title: 'PREV', blocks: [
          ...Array.from({ length: 6 }, (_, i) => ({ type: 'bullets' as const, items: [`filler ${i} with a line of real length`, 'and a second'] })),
          { type: 'heading' as const, text: '9. The Section' },
          { type: 'table' as const, headers: ['Symptom', 'Cause'], rows: Array.from({ length: 14 }, (_, i) => [`symptom ${i}`, `cause ${i}`]) },
        ] },
        { page_title: 'PREV (cont.)', cont: true, blocks: [{ type: 'bullets' as const, items: ['tail line'] }] },
      ],
      caption: { text: '', hashtags: [] },
    });
    const dir = path.join(tmpdir(), `iolar-test-tail-heading-${Date.now()}`);
    const slides = post.slides.map((s) => ({ ...s, blocks: [...s.blocks] }));
    const results = [];
    for (let i = 0; i < slides.length; i++) {
      const file = path.join(dir, `slide-${i + 1}.png`);
      const r = await renderSlide({ ...post, slides }, i, file);
      results.push({ slide: i + 1, overflowPx: r.overflowPx, fillPct: r.fillPct, file, warnings: r.warnings });
    }
    await balanceTail(post, dir, slides, results);
    expect(slides[0].blocks.at(-1)!.type).not.toBe('heading');
    expect(slides.reduce((n, s) => n + s.blocks.length, 0)).toBe(9);
  }, 300_000);
});

describe('renderSlide on an overstuffed page', () => {
  it('names the blocks it could not draw, so a single-slide render can say so', async () => {
    const post = validatePost({
      brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 7,
      series: 'SPILL TEST', date: '08/09/2026',
      slides: [{
        page_title: 'TOO MUCH',
        blocks: Array.from({ length: 40 }, (_, i) => ({
          type: 'bullets',
          items: [`point ${i} of a page that cannot hold them all`, 'second line', 'third line'],
        })),
      }],
      caption: { text: '', hashtags: [] },
    });
    const out = path.join(tmpdir(), `iolar-test-spill-${Date.now()}.png`);
    const r = await renderSlide(post, 0, out);
    expect(r.spillIndexes.length).toBeGreaterThan(0);
    // What is drawn still fits the page: the rest is left out, not overflowing it.
    expect(r.overflowPx).toBe(0);
  });
});

describe('renderSlide', () => {
  it.each(['spiral-notes', 'margin-qa', 'blackboard', 'studygram-pastel', 'engineer-grid', 'terminal-dark', 'legal-pad', 'sticky-wall', 'study-sheet', 'sketchnote', 'marker-notes'])('%s produces a 1080x1440 png with no overflow', async (template) => {
    const out = path.join(tmpdir(), `iolar-test-${template}-${Date.now()}.png`);
    const r = await renderSlide(makePost(template), 0, out);
    expect(existsSync(out)).toBe(true);
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1440]);
    expect(r.overflowPx).toBe(0);
  }, 90_000);

  it('spills overflowing content instead of overflowing the page', async () => {
    const big = makePost('spiral-notes');
    big.slides[0].blocks = Array.from({ length: 40 }, () => ({
      type: 'paragraph' as const,
      text: 'Long line of handwritten content that keeps going. '.repeat(4),
    }));
    const out = path.join(tmpdir(), `iolar-ovf-${Date.now()}.png`);
    const r = await renderSlide(big, 0, out);
    expect(r.overflowPx).toBe(0);
    expect(r.spillIndexes.length).toBeGreaterThan(0);
  }, 90_000);

  it('renderAll chains spill onto new slides', async () => {
    const big = makePost('spiral-notes');
    big.slides[0].blocks = Array.from({ length: 40 }, () => ({
      type: 'paragraph' as const,
      text: 'Long line of handwritten content that keeps going. '.repeat(4),
    }));
    const dir = path.join(tmpdir(), `iolar-flow-${Date.now()}`);
    const { results, slides } = await renderAll(big, dir);
    expect(slides.length).toBeGreaterThan(1);
    expect(results.length).toBe(slides.length);
    expect(results.every((r) => r.overflowPx === 0)).toBe(true);
    expect(slides[1].page_title).toContain('(cont.)');
    expect(slides[1].cont).toBe(true);
    const totalBlocks = slides.reduce((n, s) => n + s.blocks.length, 0);
    expect(totalBlocks).toBe(40);

    // Content is never trimmed or spread thin: every page but the last is filled to capacity.
    const fills = results.map((r) => r.fillPct);
    for (const f of fills.slice(0, -1)) expect(f).toBeGreaterThan(85);

    // Idempotent: re-rendering the split result must not split it again.
    const again = await renderAll({ ...big, slides }, dir);
    expect(again.slides.length).toBe(slides.length);
  }, 480_000);

  it.each(['spiral-notes', 'margin-qa', 'blackboard', 'studygram-pastel', 'engineer-grid', 'terminal-dark', 'legal-pad', 'sticky-wall', 'study-sheet', 'sketchnote', 'marker-notes'])(
    '%s fills a dense page without overflowing',
    async (template) => {
      const dense = makePost(template);
      dense.slides[0].blocks = [
        { type: 'heading', text: '1. Overview' },
        { type: 'paragraph', text: 'A dense page exercising the packer with mixed block widths and heights.' },
        { type: 'bullets', items: ['first point', 'second point', 'third point', 'fourth point'] },
        { type: 'heading', text: '2. Comparison' },
        { type: 'table', headers: ['Type', 'Ordered', 'Mutable', 'Use'], rows: [['list', 'yes', 'yes', 'sequence'], ['tuple', 'yes', 'no', 'fixed'], ['set', 'no', 'yes', 'unique']] },
        { type: 'heading', text: '3. Example' },
        { type: 'code', lang: 'python', lines: ['xs = [1, 2, 3]', 'xs.append(4)', 'print(xs)'] },
        { type: 'sidebox', title: 'Remember', items: ['sets drop duplicates', 'tuples hash'], ink: 'green' },
        { type: 'callout', style: 'tip', title: 'Interview Tip', text: 'Name the complexity before you pick the container.' },
      ];
      const out = path.join(tmpdir(), `iolar-dense-${template}-${Date.now()}.png`);
      const r = await renderSlide(dense, 0, out);
      expect(r.overflowPx).toBe(0);
      expect(r.spillIndexes).toEqual([]);
    },
    120_000
  );

  it('is deterministic: same seed => identical bytes', async () => {
    const a = path.join(tmpdir(), `iolar-a-${Date.now()}.png`);
    const b = path.join(tmpdir(), `iolar-b-${Date.now()}.png`);
    await renderSlide(makePost('spiral-notes'), 0, a);
    await renderSlide(makePost('spiral-notes'), 0, b);
    const [ba, bb] = await Promise.all([sharp(a).raw().toBuffer(), sharp(b).raw().toBuffer()]);
    expect(Buffer.compare(ba, bb)).toBe(0);
  }, 120_000);
});

function kitchenSink(template: string): Post {
  return validatePost({
    brand: 'iolar', template, ratio: '3:4', seed: 11,
    series: 'BINARY SEARCH PATTERNS', date: '06/09/2026',
    slides: [{
      page_title: 'Every New Block', blocks: [
        { type: 'heading', text: '1. What is it?' },
        { type: 'paragraph', text: 'Finds a target in a ==sorted array== by __halving__ the space.', frame: 'dashed', ink: 'green' },
        { type: 'heading', text: '2. Steps' },
        { type: 'bullets', style: 'number', items: ['Start with the whole array', 'Find the middle', 'Go **left** or **right**'] },
        { type: 'heading', text: '3. Mistakes' },
        { type: 'bullets', style: 'cross', items: ['`(low + high) / 2` overflows', 'Using `<` in the loop'], frame: 'solid', ink: 'red' },
        { type: 'code', lang: 'java', lines: ['int mid = low + (high - low) / 2;', 'if (arr[mid] == target) return mid;'], note: 'sorted only' },
        { type: 'diagram', kind: 'array', spec: { cells: ['2', '5', '8', '12', '16', '23', '38'], pointers: [{ index: 0, label: 'low' }, { index: 3, label: 'mid', ink: 'red' }, { index: 6, label: 'high' }], highlight: [3], dim: [0, 1], caption: '12 < 16 → right' } },
        { type: 'table', headers: ['Step', 'low', 'high', 'mid', 'action'], rows: [['1', '0', '8', '4', 'right'], ['2', '5', '8', '6', 'left'], ['3', '5', '5', '5', 'found']], highlightRow: 2 },
        { type: 'diagram', kind: 'flowchart', spec: {
          rows: [['s'], ['m'], ['d'], ['l', 'r'], ['e']],
          nodes: { s: { text: 'Start', shape: 'pill' }, m: { text: 'mid = low + (high-low)/2' }, d: { text: 'arr[mid] == target?', shape: 'diamond' }, l: { text: 'Search left', ink: 'blue' }, r: { text: 'Search right', ink: 'blue' }, e: { text: 'Not found', ink: 'red' } },
          edges: [{ from: 's', to: 'm' }, { from: 'm', to: 'd' }, { from: 'd', to: 'l', label: 'no' }, { from: 'd', to: 'r', label: 'no' }, { from: 'l', to: 'e' }, { from: 'r', to: 'e' }],
        } },
        { type: 'callout', style: 'sticky', title: 'Key idea', text: 'One half is always sorted' },
        { type: 'diagram', kind: 'matrix', spec: { rows: [['1', '3', '5'], ['10', '11', '16']], highlight: [[1, 2]], caption: 'n = 3' } },
        { type: 'diagram', kind: 'flow', spec: { nodes: [{ text: 'Define', sub: 'answer', ink: 'red' }, { text: 'Search space', ink: 'orange' }, { text: 'isPossible', ink: 'blue' }] } },
        { type: 'diagram', kind: 'cards', spec: { cards: [{ title: 'Find target', lines: ['compare arr[low] & arr[mid]'] }, { title: 'Find pivot', lines: ['compare arr[mid] & arr[high]'], ink: 'orange' }, { title: 'Duplicates', lines: ['low++, high--'], ink: 'purple' }] } },
      ],
    }],
    caption: { text: '', hashtags: [] },
  });
}

describe('new blocks render', () => {
  it.each(['study-sheet', 'spiral-notes'])('%s renders every new block on one page with no overflow', async (template) => {
    const out = path.join(tmpdir(), `iolar-sink-${template}.png`);
    const r = await renderSlide(kitchenSink(template), 0, out);
    expect(existsSync(out)).toBe(true);
    expect(r.overflowPx).toBe(0);
    expect(r.warnings).toEqual([]);
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1440]);
  }, 90_000);

  it('reports a truncated code line as a warning', async () => {
    const post = kitchenSink('spiral-notes');
    post.slides[0].blocks = [{ type: 'code', lang: 'python', lines: ['x'.repeat(95)] }];
    const r = await renderSlide(post, 0, path.join(tmpdir(), 'iolar-warn.png'));
    expect(r.warnings).toEqual(['block 0: code line 1 truncated at 80 chars']);
  }, 90_000);

  it('writes a contact sheet of the kitchen sink across every family', async () => {
    const { TEMPLATES } = await import('@/lib/schema');
    const tiles: Buffer[] = [];
    for (const template of TEMPLATES) {
      const out = path.join(tmpdir(), `iolar-sink-${template}.png`);
      const r = await renderSlide(kitchenSink(template), 0, out);
      expect(r.overflowPx, template).toBe(0);
      tiles.push(await sharp(out).resize(360, 480).png().toBuffer());
    }
    const cols = 3, rows = Math.ceil(tiles.length / cols);
    const sheet = path.join(tmpdir(), 'iolar-blocks-contact.png');
    await sharp({ create: { width: cols * 360, height: rows * 480, channels: 3, background: '#ffffff' } })
      .composite(tiles.map((input, i) => ({ input, left: (i % cols) * 360, top: Math.floor(i / cols) * 480 })))
      .png().toFile(sheet);
    expect(existsSync(sheet)).toBe(true);
    console.log('contact sheet:', sheet);
  }, 600_000);
});

function kitchenSink2(template: string): Post {
  return validatePost({
    brand: 'iolar', template, ratio: '3:4', seed: 12,
    series: 'AWS COMPLETE NOTES (Part 1)', date: '06/09/2026',
    slides: [
      { page_title: 'cover', kind: 'cover', blocks: [], hero: 'aws', cover: { title: 'AWS', subtitle: 'Complete Notes', tagline: 'All Important AWS Services in One Place', icons: [{ icon: 'ec2', label: 'Compute', sub: 'EC2, Lambda' }, { icon: 's3', label: 'Storage', sub: 'S3, EBS' }, { icon: 'rds', label: 'Database' }, { icon: 'iam', label: 'Security' }], pills: ['EC2', 'S3', 'RDS', 'VPC'] } },
      { page_title: 'AWS IAM', subtitle: 'Identity and Access Management', hero: 'iam', blocks: [
        { type: 'paragraph', text: 'IAM controls access to ==AWS services== {icon:aws} and resources.' },
        { type: 'heading', text: '1. Key Concepts' },
        { type: 'diagram', kind: 'cards', spec: { cards: [{ title: 'Users', icon: 'user', text: 'An identity.' }, { title: 'Groups', icon: 'users', text: 'Users together.' }, { title: 'Roles', icon: 'shield', text: 'Temporary.' }, { title: 'DDL', code: ['CREATE TABLE t (', '  id INT', ');'] }, { title: '2-Tier', chain: ['Client', 'DB Server'] }] } },
        { type: 'heading', text: '2. RDS Architecture' },
        { type: 'diagram', kind: 'flowchart', spec: { title: 'RDS Architecture', rows: [['app'], ['rds'], ['r1', 'r2']], nodes: { app: { text: 'Application', shape: 'icon', icon: 'laptop' }, rds: { text: 'RDS', shape: 'icon', icon: 'rds' }, r1: { text: 'Replica', shape: 'icon', icon: 'database' }, r2: { text: 'Replica', shape: 'icon', icon: 'database' } }, edges: [{ from: 'app', to: 'rds' }, { from: 'rds', to: 'r1' }, { from: 'rds', to: 'r2' }] } },
        { type: 'heading', text: '3. Key hierarchy' },
        { type: 'diagram', kind: 'chain', spec: { title: 'KEY HIERARCHY', steps: [{ text: 'Super Key', note: 'any set', ink: 'green' }, { text: 'Candidate Key', note: 'minimal', ink: 'orange' }] } },
        { type: 'bullets', style: 'checkbox', items: ['{icon:ec2} **EC2** compute', '{icon:docker} Docker on {icon:eks} EKS'] },
        { type: 'bullets', style: 'star', items: ['Host web apps in public subnets'] },
        { type: 'diagram', kind: 'schema', spec: { tables: [{ name: 'DEPARTMENT', columns: ['ID (PK)', 'Dept_Name'] }, { name: 'STUDENT', columns: ['Roll_No (PK)', 'Dept_ID (FK)'] }], links: [{ from: 'DEPARTMENT', to: 'STUDENT', fromLabel: '1', toLabel: 'N', arrow: true }] } },
        { type: 'callout', style: 'cloud', title: 'Key Takeaway', text: 'The relational model is the foundation of RDBMS.' },
        { type: 'diagram', kind: 'tables', spec: { arrow: true, tables: [{ title: 'Before', headers: ['a', 'b'], rows: [['1', '2']] }, { title: 'After', headers: ['a', 'b'], rows: [['1', '2']] }] } },
        { type: 'diagram', kind: 'er', spec: { entities: [{ name: 'STUDENT', attrs: ['Roll_No', 'Name'], key: 'Roll_No' }, { name: 'COURSE', attrs: ['Course_ID'], key: 'Course_ID' }], relations: [{ from: 'STUDENT', to: 'COURSE', name: 'ENROLLS', labels: ['M', 'N'] }] } },
        { type: 'paragraph', text: 'Example : STUDENT (__Roll_No__, Name, Dept)', frame: 'dashed', ink: 'pink' },
      ] },
    ],
    caption: { text: '', hashtags: [] },
  });
}

describe('set 2/3 blocks render', () => {
  it.each(['sketchnote', 'marker-notes', 'study-sheet'])('%s renders the cover and the icon page with no overflow', async (template) => {
    const post = kitchenSink2(template);
    for (const i of [0, 1]) {
      const out = path.join(tmpdir(), `iolar-sink2-${template}-${i + 1}.png`);
      const r = await renderSlide(post, i, out);
      expect(existsSync(out)).toBe(true);
      expect(r.overflowPx, `${template} slide ${i + 1}`).toBe(0);
      expect(r.warnings).toEqual([]);
    }
  }, 180_000);

  it('renderAll keeps the cover as its own first page and flows the rest', async () => {
    const post = kitchenSink2('sketchnote');
    const dir = path.join(tmpdir(), `iolar-sink2-all-${Date.now()}`);
    const { results, slides } = await renderAll(post, dir);
    expect(slides[0].kind).toBe('cover');
    expect(slides[0].blocks.length).toBe(0);
    expect(results[0].slide).toBe(1);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every((r) => r.overflowPx === 0)).toBe(true);
    // Auto-flow rebuilds pages from the block stream; the chapter's hero and subtitle must survive.
    expect(slides[1].hero).toBe('iam');
    expect(slides[1].subtitle).toBe('Identity and Access Management');
  }, 300_000);
});

describe('flow keeps authored order', () => {
  // Questions 33-44 with answers of very different heights and a small table after some of them:
  // the shapes that used to leave a gap a later, smaller block slipped into, so a page ended on
  // Q34 while Q33 opened the next one.
  const numbered = () => {
    const out: Post['slides'][number]['blocks'] = [];
    const bullets = [4, 5, 2, 5, 3, 5, 2, 4, 5, 3, 2, 5];
    bullets.forEach((n, i) => {
      out.push({
        type: 'qa', q: `Q${33 + i}. Question number ${33 + i} asked in the interview?`,
        a_bullets: Array.from({ length: n }, (_, k) => `Answer point ${k + 1} for question ${33 + i}, a sentence long enough to wrap onto a second line of the column.`),
      });
      if (i % 3 === 1) out.push({ type: 'table', headers: ['Key', 'Meaning'], rows: [['a', 'first'], ['b', 'second']] });
    });
    return out;
  };

  it.each(['study-sheet', 'notebook'])('%s: no block is printed ahead of one authored before it', async (template) => {
    const post = validatePost({
      brand: 'iolar', template, ratio: '3:4', seed: 7, series: 'ORDER', date: 'd',
      slides: [{ page_title: 'Questions', blocks: numbered() }],
      caption: { text: '', hashtags: [] },
    });
    const dir = path.join(tmpdir(), `iolar-order-${template}-${Date.now()}`);
    const { slides } = await renderAll(post, dir);
    expect(slides.length).toBeGreaterThan(1);
    const flat = slides.flatMap((s) => s.blocks);
    expect(flat.length).toBe(numbered().length);
    expect(flat.map((b) => JSON.stringify(b))).toEqual(numbered().map((b) => JSON.stringify(b)));
    const qs = flat.filter((b) => b.type === 'qa').map((b) => Number(/^Q(\d+)/.exec((b as { q: string }).q)![1]));
    expect(qs).toEqual([...qs].sort((a, b) => a - b));
  }, 300_000);
});

describe('notebook family', () => {
  const listicle = () => validatePost({
    brand: 'iolar', template: 'notebook', ratio: '3:4', seed: 42, series: '10 DATABASE CONCEPTS', date: 'd',
    slides: [
      { page_title: 'cover', kind: 'cover', hero: 'database', aside: 'Build. Learn. Grow', blocks: [], cover: {
        title: "Database Concepts You Can't Skip", subtitle: 'in System Design Interviews', tagline: '10 core concepts',
        icons: [{ icon: 'table', label: 'Data' }, { icon: 'server', label: 'Storage' }, { icon: 'users', label: 'Users' }],
        pills: ['Clear explanations.', 'Practical diagrams.', 'Better interview answers.'] } },
      { page_title: 'Indexing', aside: 'Big Performance', blocks: [
        { type: 'concept', number: 1, title: 'Indexing', tagline: 'find fast' },
        { type: 'labelrows', rows: [
          { icon: 'lightbulb', label: 'What it is:', text: 'A structure that helps the database find rows faster.' },
          { icon: 'shield-check', label: 'Why it exists:', text: 'Avoid scanning the whole table for every query.' },
          { icon: 'settings', label: 'Used for:', text: 'Fast lookups, filtering, sorting, joins.' }] },
        { type: 'heading', text: 'How it works', style: 'ribbon' },
        { type: 'code', lang: 'sql', lines: ['SELECT n FROM t WHERE k = 7;'], result: { headers: ['n'], rows: [['1'], ['2']] } },
        { type: 'qa', q: 'Q1. What is an index?', a_bullets: ['A sorted lookup structure.'] },
        { type: 'callout', style: 'banner', title: 'Interview takeaway:', text: 'Index what you filter and join on.' },
      ] },
    ],
    caption: { text: '', hashtags: [] },
  });

  it('draws the cover and a concept page with no overflow, no warnings', async () => {
    const post = listicle();
    for (const i of [0, 1]) {
      const r = await renderSlide(post, i, path.join(tmpdir(), `iolar-notebook-${i + 1}.png`));
      expect(r.overflowPx, `slide ${i + 1}`).toBe(0);
      expect(r.spillIndexes, `slide ${i + 1}`).toEqual([]);
      expect(r.warnings).toEqual([]);
    }
  }, 120_000);

  it('re-stamps "of N" once the flow knows the page count', async () => {
    // A part that flows to more pages than it was authored with must come out with the final count in every page.
    const post = listicle();
    post.slides[1].blocks = Array.from({ length: 24 }, () => ({ type: 'paragraph' as const, text: 'Filler sentence that makes the page long enough to spill. '.repeat(3) }));
    const dir = path.join(tmpdir(), `iolar-nb-count-${Date.now()}`);
    const { slides, results } = await renderAll(post, dir);
    expect(slides.length).toBeGreaterThan(2);
    const { buildSlideHtml } = await import('@/lib/renderer/page');
    expect(buildSlideHtml({ ...post, slides }, 0)).toContain(`"pageCount":${slides.length}`);
    expect(results.every((r) => r.overflowPx === 0)).toBe(true);
  }, 300_000);
});

describe('a block taller than a page', () => {
  const longCode = () => Array.from({ length: 90 }, (_, i) => `SELECT col_${i}, other_${i} FROM table_${i} WHERE id = ${i};`);

  it.each(['study-sheet', 'notebook'])('%s: a code block taller than the page splits across pages, in order, with nothing clipped', async (template) => {
    const post = validatePost({
      brand: 'iolar', template, ratio: '3:4', seed: 3, series: 'LONG CODE', date: 'd',
      slides: [{ page_title: 'Schema', blocks: [
        { type: 'heading', text: '1. The whole schema' },
        { type: 'code', lang: 'sql', lines: longCode(), note: 'ends here', result: { headers: ['n'], rows: [['1']] } },
      ] }],
      caption: { text: '', hashtags: [] },
    });
    const dir = path.join(tmpdir(), `iolar-longcode-${template}-${Date.now()}`);
    const { slides, results } = await renderAll(post, dir);
    expect(slides.length).toBeGreaterThan(1);
    expect(results.every((r) => r.overflowPx === 0)).toBe(true);
    const codes = slides.flatMap((s) => s.blocks).filter((b) => b.type === 'code') as Extract<Post['slides'][number]['blocks'][number], { type: 'code' }>[];
    expect(codes.flatMap((c) => c.lines)).toEqual(longCode());
    // The note and the result belong to the end of the code, so they ride on the last part only.
    expect(codes.slice(0, -1).every((c) => !c.note && !c.result)).toBe(true);
    expect(codes[codes.length - 1].note).toBe('ends here');
  }, 300_000);
});

describe('a stranded takeaway', () => {
  const filler = (n: number) => Array.from({ length: n }, (_, i) => ({ type: 'bullets' as const, items: [`point ${i} carrying a line of real length`, 'a second line of the same'] }));
  const banner = { type: 'callout' as const, style: 'banner' as const, title: 'Key takeaways', text: 'The page, said again.' };
  const build = (blocks: unknown[]) => validatePost({
    brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 5, series: 'TAKEAWAY', date: 'd',
    slides: [{ page_title: 'Page', blocks }], caption: { text: '', hashtags: [] },
  });

  it('is dropped, with a warning, instead of opening a page of its own', async () => {
    // The largest filler that leaves the banner as the only block off the page.
    let n = 8;
    for (; n < 40; n++) {
      const probe = await renderSlide(build([...filler(n), banner]), 0, path.join(tmpdir(), `iolar-strand-probe-${Date.now()}.png`));
      if (probe.spillIndexes.length === 1 && probe.spillIndexes[0] === n) break;
    }
    expect(n).toBeLessThan(40);
    const { slides, results } = await renderAll(build([...filler(n), banner]), path.join(tmpdir(), `iolar-strand-${Date.now()}`));
    expect(slides).toHaveLength(1);
    expect(slides[0].blocks.some((b) => b.type === 'callout')).toBe(false);
    expect(results[0].warnings).toContain('dropped stranded takeaway');
  }, 300_000);
});
