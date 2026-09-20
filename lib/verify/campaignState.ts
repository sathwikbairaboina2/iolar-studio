import { promises as fs } from 'fs';
import path from 'path';
import { dataRoot } from '../paths';

/** The three stages a part passes through. Coverage is keyed per chapter, the rest per part. */
export type Stage = 'coverage' | 'polish' | 'review';

export type CampaignState = { done: Record<string, string> };

/** Lives beside the content it describes, so a data dir carries its own progress. */
export function stateFile() {
  return path.join(dataRoot(), '.campaign-state.json');
}

/** A corrupt or absent file is an empty run, never a crash — the campaign is long. */
export async function loadState(): Promise<CampaignState> {
  try {
    const parsed = JSON.parse(await fs.readFile(stateFile(), 'utf8')) as CampaignState;
    return parsed && typeof parsed.done === 'object' && parsed.done ? parsed : { done: {} };
  } catch {
    return { done: {} };
  }
}

const slot = (key: string, stage: Stage) => `${key}:${stage}`;

export function isDone(state: CampaignState, key: string, stage: Stage): boolean {
  return Boolean(state.done[slot(key, stage)]);
}

/** Records the stage and writes immediately: a crash must cost one stage, not the run. */
export async function markDone(state: CampaignState, key: string, stage: Stage): Promise<void> {
  state.done[slot(key, stage)] = new Date().toISOString();
  await fs.mkdir(path.dirname(stateFile()), { recursive: true });
  await fs.writeFile(stateFile(), JSON.stringify(state, null, 2));
}
