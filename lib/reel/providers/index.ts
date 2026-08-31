import { registerVideoProvider } from '../videoProvider';
import { createWebpageProvider } from './webpage';
import { createLipsyncProvider } from './lipsync';

/**
 * Wires the user's renderers in.
 *
 * Importing this module registers them, which is why every route that renders
 * imports it for the side effect. Registration is deliberately not conditional
 * on the services being up: `available()` is asked at the moment a beat is
 * queued, so a plugin that is down produces a beat waiting for a human rather
 * than a studio that decided at boot that rendering was impossible.
 */

let wired = false;

export function wireProviders(): void {
  if (wired) return;
  registerVideoProvider('webpage', createWebpageProvider());
  registerVideoProvider('lipsync', createLipsyncProvider());
  wired = true;
}

wireProviders();
