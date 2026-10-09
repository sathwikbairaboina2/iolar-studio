import { promises as fs } from 'fs';
import path from 'path';
import { subjectDir } from '@/lib/paths';
import type { Finding } from '@/lib/verify/gates';

export type Verdict = 'pass' | 'unsure' | 'fail';
export type ChapterState = {
  selected: boolean;
  /** Inputs hash: book.json plus every part's post.json when the edition was reviewed. */
  hash?: string;
  /** Hash of the edition sections that were reviewed. */
  editionHash?: string;
  verdict?: Verdict;
  findings?: Finding[];
  reviewedAt?: string;
  approvedBy?: 'ai' | 'human';
  approvedAt?: string;
  rejected?: boolean;
};
export type OrderState = {
  order: string[];
  prerequisites: Record<string, string[]>;
  gaps: string[];
  overlaps: string[];
  confidence: number;
  approvedBy?: 'ai' | 'human';
  /** Sorted selected slugs with their hashes: the order is proposed again only when this changes. */
  basis: string;
};
export type PublishState = { alwaysAsk: boolean; chapters: Record<string, ChapterState>; order?: OrderState; exportedAt?: string };

/** Publishing decisions live beside the subject, not in the index database, which can be rebuilt. */
export function stateFile(subject: string) {
  return path.join(subjectDir(subject), 'publish.json');
}

export async function readState(subject: string): Promise<PublishState> {
  try {
    const s = JSON.parse(await fs.readFile(stateFile(subject), 'utf8')) as Partial<PublishState>;
    return { ...s, alwaysAsk: !!s.alwaysAsk, chapters: s.chapters ?? {} };
  } catch {
    return { alwaysAsk: false, chapters: {} };
  }
}

export async function writeState(subject: string, s: PublishState): Promise<void> {
  const file = stateFile(subject);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, JSON.stringify(s, null, 2));
  await fs.rename(`${file}.tmp`, file);
}

/** Selected, not rejected, never failed, and cleared by the AI (a pass) or by a person. */
export function liveChapters(s: PublishState): string[] {
  return Object.entries(s.chapters)
    .filter(([, c]) => c.selected && !c.rejected && c.verdict !== 'fail' && ((c.verdict === 'pass' && !!c.approvedBy) || c.approvedBy === 'human'))
    .map(([slug]) => slug);
}

/** What waits for a person: selected passing or unsure chapters without an approval (a pass waits only when Always ask me is on), and an order nobody approved. */
export function queue(s: PublishState): { chapters: string[]; order: boolean } {
  return {
    chapters: Object.entries(s.chapters)
      .filter(([, c]) => c.selected && !c.rejected && (c.verdict === 'unsure' || c.verdict === 'pass') && !c.approvedBy)
      .map(([slug]) => slug),
    order: !!s.order && !s.order.approvedBy,
  };
}

const chains = new Map<string, Promise<unknown>>();

/** Read, change and write the state one caller at a time, so a job and a click never overwrite each other. */
export function updateState<T = void>(subject: string, fn: (s: PublishState) => T | Promise<T>): Promise<T> {
  const run = (chains.get(subject) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await readState(subject);
    const out = await fn(s);
    await writeState(subject, s);
    return out;
  });
  chains.set(subject, run);
  return run;
}
