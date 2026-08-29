import { Post, Block } from '../schema';

export type BlockDiff = {
  index: number;
  kind: 'added' | 'removed' | 'changed';
  before?: Block;
  after?: Block;
};

export type SlideDiff = {
  slide: number; // 1-based
  kind: 'added' | 'removed' | 'changed';
  titleChanged?: { before: string; after: string };
  blocks: BlockDiff[];
};

export function diffPosts(before: Post, after: Post): SlideDiff[] {
  const out: SlideDiff[] = [];
  const max = Math.max(before.slides.length, after.slides.length);

  for (let i = 0; i < max; i++) {
    const b = before.slides[i];
    const a = after.slides[i];
    if (b && !a) {
      out.push({ slide: i + 1, kind: 'removed', blocks: [] });
      continue;
    }
    if (!b && a) {
      out.push({
        slide: i + 1, kind: 'added',
        blocks: a.blocks.map((blk, j) => ({ index: j, kind: 'added' as const, after: blk })),
      });
      continue;
    }
    if (!b || !a) continue;

    const blocks: BlockDiff[] = [];
    const bmax = Math.max(b.blocks.length, a.blocks.length);
    for (let j = 0; j < bmax; j++) {
      const bb = b.blocks[j];
      const ab = a.blocks[j];
      if (bb && !ab) blocks.push({ index: j, kind: 'removed', before: bb });
      else if (!bb && ab) blocks.push({ index: j, kind: 'added', after: ab });
      else if (JSON.stringify(bb) !== JSON.stringify(ab)) blocks.push({ index: j, kind: 'changed', before: bb, after: ab });
    }
    const titleChanged = b.page_title !== a.page_title
      ? { before: b.page_title, after: a.page_title }
      : undefined;
    if (blocks.length || titleChanged) {
      out.push({ slide: i + 1, kind: 'changed', titleChanged, blocks });
    }
  }
  return out;
}
