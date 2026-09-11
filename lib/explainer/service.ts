import { ServiceDown, templates } from '@/lib/templates/service';

/**
 * What the studio knows about rendering an explainer: nothing, except how to ask.
 *
 * The templates service on 26200 owns the contract, the validation and the pixels. The studio
 * fetches what it is allowed to author and quotes the limits it is given. Every limit shown in
 * the editor comes from here rather than being restated — a number restated in two places is a number
 * that will disagree with itself.
 */

export type ExplainerContract = {
  themes: string[];
  themeModes: Record<string, 'light' | 'dark'>;
  mutations: Record<string, { requires: string[]; sets?: string[]; fields?: string[] }>;
  states: string[];
  icons: string[];
  roles: string[];
  defaults: Record<string, number>;
  limits: Record<string, number>;
};

/** The contract, or null when the service is down — a dead service is not an error to the editor. */
export async function contract(): Promise<ExplainerContract | null> {
  try {
    const all = await templates();
    const found = all.find((t) => t.name === 'explainer') as unknown as ExplainerContract | undefined;
    return found ?? null;
  } catch (err) {
    if (err instanceof ServiceDown) return null;
    throw err;
  }
}

export { ServiceDown };
export { ServiceRejected } from '@/lib/templates/service';
