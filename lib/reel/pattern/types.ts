import type { z } from 'zod';
import type { Reel } from '../schema';
import type { Script } from '../research/script';

/**
 * What every pattern definition provides. The reel schema treats sections as opaque; a
 * definition owns their shape, the prompt that writes them, the order they are timed in,
 * and the document the templates service renders from.
 */

export type Limits = Record<string, number>;
export type Brand = { handle: string; name: string };
export type CandidateRef = { id: string; url: string; title: string; thumbnailUrl: string | null };

/** One timed stretch of the reel: the hook, one slide, one page, the cta. */
export type Unit = { path: string; label: string; kind: string; lineIds: string[] };
export type UnitTime = Unit & { sec: number; start: number; end: number };

export class SectionError extends Error {
  constructor(public readonly path: string, message: string) {
    super(message);
    this.name = 'SectionError';
  }
}

export type PromptInput = {
  script: Script;
  candidates: Record<string, CandidateRef>;
  brand: Brand;
  limits: Limits;
  themes: string[];
  /** What was wrong with the last answer, quoted back on the retry. */
  errors?: string[];
};

export type DocInput = {
  reel: Reel;
  script: Script;
  sections: unknown[];
  times: UnitTime[];
  brand: Brand;
  captions: boolean;
  assets: { vo: string | null; presenter: string | null; words: { w: string; start: number; end: number }[] };
};

export type PatternDef = {
  name: string;
  SectionsSchema: z.ZodType<unknown[]>;
  prompt(input: PromptInput): string;
  /** Model text to checked sections; throws SectionError. */
  parse(raw: string, script: Script, candidates: Record<string, CandidateRef>, limits: Limits): unknown[];
  /** Every invariant and limit; empty when the sections are sound. */
  check(sections: unknown[], script: Script, candidates: Record<string, CandidateRef>, limits: Limits): SectionError[];
  units(sections: unknown[]): Unit[];
  doc(input: DocInput): unknown;
};
