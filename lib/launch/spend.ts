import { promises as fs } from 'fs';
import path from 'path';
import { launchFile } from '@/lib/paths';
import { HfUnreachable, type Hf } from './higgsfield';
import { SpendSchema, spent, type Spend, type SpendEntry } from './schema';
import { readBrief } from './store';

/**
 * Credits. Every Higgsfield generation is preflighted with its cost and refused when it would take the reel past its
 * budget; every call, and the balance after it, is recorded in spend.json.
 */

export { SpendSchema, spent, type Spend, type SpendEntry };

export async function readSpend(slug: string): Promise<Spend | null> {
  try {
    return SpendSchema.parse(JSON.parse(await fs.readFile(launchFile(slug, 'spend.json'), 'utf8')));
  } catch {
    return null;
  }
}

async function record(slug: string, budget: number, entry: Omit<SpendEntry, 'at'>): Promise<void> {
  const s = (await readSpend(slug)) ?? { budget, entries: [] };
  s.budget = budget;
  s.entries.push({ at: new Date().toISOString(), ...entry });
  await fs.mkdir(path.dirname(launchFile(slug, 'spend.json')), { recursive: true });
  await fs.writeFile(launchFile(slug, 'spend.json'), JSON.stringify(s, null, 2));
}

/** Calls for one reel run one at a time, so the budget check and the record are never interleaved. */
const queues = new Map<string, Promise<unknown>>();

/**
 * Preflights the cost of `params`; past the budget it records `skipped-over-budget` and returns null. Otherwise it
 * submits, reads the balance and records `spent`. A submit that throws may still have been charged: it is recorded as
 * `unknown`, counted, and never retried. An unreachable Higgsfield passes through for the caller to handle.
 */
const message = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

export function withBudget<T>(slug: string, hf: Pick<Hf, 'cost' | 'balance'>, what: string, params: object, submit: () => Promise<T>): Promise<T | null> {
  const run = async (): Promise<T | null> => {
    const budget = (await readBrief(slug))?.creditBudget ?? 0;
    let cost: number | null = null;
    // A preflight costs nothing, so a reply without a cost is asked once more before the call is given up.
    for (let attempt = 0; attempt < 2 && cost === null; attempt++) {
      try {
        cost = await hf.cost(params);
      } catch (err) {
        if (err instanceof HfUnreachable) throw err;
        if (attempt === 1) {
          await record(slug, budget, { what, credits: 0, balanceAfter: null, outcome: 'failed', error: message(err) });
          return null;
        }
      }
    }
    if (cost === null) return null;
    const so = (await readSpend(slug)) ?? { budget, entries: [] };
    if (spent(so) + cost > budget) {
      await record(slug, budget, { what, credits: cost, balanceAfter: null, outcome: 'skipped-over-budget' });
      return null;
    }
    let result: T;
    try {
      result = await submit();
    } catch (err) {
      await record(slug, budget, { what, credits: cost, balanceAfter: null, outcome: 'unknown', error: message(err) });
      return null;
    }
    const balanceAfter = await hf.balance().catch(() => null);
    await record(slug, budget, { what, credits: cost, balanceAfter, outcome: 'spent' });
    return result;
  };
  const next = (queues.get(slug) ?? Promise.resolve()).then(run, run);
  queues.set(slug, next.catch(() => undefined));
  return next;
}
