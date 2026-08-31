import { promises as fs } from 'fs';
import path from 'path';
import { reelBriefFile, reelCandidatesFile, reelEvidenceDir, reelHuntFile, reelResearchDir, reelScriptFile, reelSelectionFile } from '@/lib/paths';
import { parseBrief, type Brief } from './brief';
import { parseCandidates, type CandidatesFile } from './candidate';
import { emptySelection, parseSelection, type Selection } from './selection';
import { parseScript, type Script } from './script';
import { parseEvidence, type Evidence } from './gather';

/**
 * Where a reel's research lives: `data/reel/<slug>/research/`.
 *
 * Beside the reel rather than in a separate tree, so one slug owns everything
 * from the topic someone typed to the file that gets exported. The brief's
 * `status` is the state machine — it says which stage a run stopped at.
 */

export class NoResearchError extends Error {
  constructor(slug: string) {
    super(`no research for reel "${slug}" yet`);
    this.name = 'NoResearchError';
  }
}

export function researchDir(slug: string): string {
  return reelResearchDir(slug);
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function readBrief(slug: string): Promise<Brief> {
  try {
    return parseBrief(await readJson(reelBriefFile(slug)));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new NoResearchError(slug);
    throw err;
  }
}

export async function writeBrief(slug: string, brief: Brief): Promise<void> {
  await writeJson(reelBriefFile(slug), parseBrief(brief));
}

/** Which stage this reel's research reached, or null if it was never researched. */
export async function researchStatus(slug: string): Promise<Brief['status'] | null> {
  try {
    return (await readBrief(slug)).status;
  } catch (err) {
    if (err instanceof NoResearchError) return null;
    throw err;
  }
}

export async function setResearchStatus(slug: string, status: Brief['status']): Promise<Brief> {
  const next = { ...(await readBrief(slug)), status };
  await writeBrief(slug, next);
  return next;
}

/**
 * The hunt's raw findings, before the critic has judged them.
 *
 * Written the moment the hunters return. Ten minutes of searching used to live
 * only in memory until the critic had finished and the pack validated, so any
 * failure in between threw all of it away; on disk, the critic can be retried
 * against what was already found.
 */
export async function writeHunt(slug: string, found: Record<string, unknown>[]): Promise<void> {
  await writeJson(reelHuntFile(slug), found);
}

export async function readHunt(slug: string): Promise<Record<string, unknown>[]> {
  const raw = await readJson(reelHuntFile(slug)).catch(() => null);
  if (!Array.isArray(raw)) throw new NoResearchError(`no hunt on disk for ${slug}`);
  return raw as Record<string, unknown>[];
}

export async function readCandidates(slug: string): Promise<CandidatesFile> {
  return parseCandidates(await readJson(reelCandidatesFile(slug)));
}

export async function writeCandidates(slug: string, file: CandidatesFile): Promise<void> {
  await writeJson(reelCandidatesFile(slug), parseCandidates(file));
}

/** An unreviewed run has no decisions yet, which is a state rather than a failure. */
export async function readSelection(slug: string): Promise<Selection> {
  try {
    return parseSelection(await readJson(reelSelectionFile(slug)));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptySelection(slug);
    throw err;
  }
}

export async function writeSelection(slug: string, selection: Selection): Promise<void> {
  await writeJson(reelSelectionFile(slug), parseSelection(selection));
}

export async function readScript(slug: string): Promise<Script> {
  try {
    return parseScript(await readJson(reelScriptFile(slug)));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new NoResearchError(slug);
    throw err;
  }
}

export async function writeScript(slug: string, script: Script): Promise<void> {
  await writeJson(reelScriptFile(slug), parseScript(script));
}

export async function writeEvidence(slug: string, evidence: Evidence): Promise<void> {
  await writeJson(path.join(reelEvidenceDir(slug), `${evidence.candidateId}.json`), parseEvidence(evidence));
}

/** Everything gathered so far, by candidate. Nothing gathered is an empty map. */
export async function readAllEvidence(slug: string): Promise<Record<string, Evidence>> {
  let names: string[];
  try {
    names = await fs.readdir(reelEvidenceDir(slug));
  } catch {
    return {};
  }
  const out: Record<string, Evidence> = {};
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    const evidence = parseEvidence(await readJson(path.join(reelEvidenceDir(slug), name)));
    out[evidence.candidateId] = evidence;
  }
  return out;
}
