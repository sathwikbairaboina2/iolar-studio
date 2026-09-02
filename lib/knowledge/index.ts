import { getSettings } from '@/lib/settings';
import { logPlugin } from '@/lib/plugins/log';

export * from './types';
export { getStores, useStoresForTests } from './stores';
export { topicKey, topicFromPoint } from './topics';
export { pointId, claimId, hostOf } from './ids';

export function knowledgeEnabled(): boolean {
  return getSettings().knowledgeMemory !== false;
}

/**
 * Every writer runs inside this. A store that is down costs memory, not a save: the
 * error becomes one line on the Plugins page and the caller carries on.
 */
export async function safely<T>(what: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    logPlugin('knowledge', `${what} failed: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`, 'warning');
    return undefined;
  }
}
