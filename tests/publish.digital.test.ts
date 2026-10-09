import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/renderer/icons', async (orig) => ({ ...(await orig<object>()), iconSvg: (n: string) => (n === 'python' || n === 'aws' ? '<svg/>' : '') }));
const { digitalGates, iconNames } = await import('@/lib/publish/digital');

const post = (blocks: unknown[], extra: Record<string, unknown> = {}) => ({ slides: [{ page_title: 'P', blocks, ...extra }] }) as never;
describe('digitalGates', () => {
  it('flags unknown icons, slide words and page refs past the end', () => {
    const p = post([{ type: 'paragraph', text: 'Swipe to page 9 {icon:nope} {icon:python}' }]);
    const rules = digitalGates([p]).map((x) => x.rule).sort();
    expect(rules).toEqual(['digital.icon', 'digital.page-ref', 'digital.slide-words']);
  });
  it('collects icon names from fields and inline text', () => {
    expect(iconNames([post([{ type: 'labelrows', rows: [{ icon: 'aws', label: 'a', text: 'b' }] }], { hero: 'python' })]).sort()).toEqual(['aws', 'python']);
  });
});

describe('digitalReview', () => {
  const setup = () => {
    vi.resetModules();
    const root = mkdtempSync(path.join(tmpdir(), 'dig-'));
    process.env.IOLAR_DATA_DIR = root;
    const d = path.join(root, 'handbooks', 's', 'c', 'parts', '01');
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, 'post.json'), JSON.stringify({ brand: 'iolar', series: 's', date: 'd', slides: [{ page_title: 'P', blocks: [{ type: 'paragraph', text: 'tap the thing' }] }] }));
  };
  it('returns the AI findings plus the gate findings', async () => {
    setup();
    vi.doMock('@/lib/ai/claude', () => ({ runClaude: vi.fn().mockResolvedValue('{"findings":[{"severity":"major","page":1,"summary":"repeats","evidence":"e","fix":"f"}]}'), ClaudeUnavailableError: class extends Error {} }));
    const { digitalReview } = await import('@/lib/publish/digital');
    const out = await digitalReview('s', 'c');
    expect(out.map((x) => x.rule).sort()).toEqual(['digital.ai', 'digital.slide-words']);
  });
  it('reports digital.unavailable when Claude cannot run', async () => {
    setup();
    class Unavail extends Error {}
    vi.doMock('@/lib/ai/claude', () => ({ runClaude: vi.fn().mockRejectedValue(new Unavail('x')), ClaudeUnavailableError: Unavail }));
    const { digitalReview } = await import('@/lib/publish/digital');
    const out = await digitalReview('s', 'c');
    expect(out.map((x) => x.rule)).toContain('digital.unavailable');
  });
});
