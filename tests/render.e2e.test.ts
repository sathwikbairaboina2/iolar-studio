import { describe, it, expect, afterAll } from 'vitest';
import { renderSlide, renderAll, closeBrowser } from '@/lib/renderer/capture';
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
