/**
 * Runs once when the server starts (Next's instrumentation hook). It nudges the daily launch-reference check 30 seconds
 * after start, so the dev server is up first. Off with LAUNCH_WATCH=off; never runs under vitest, which does not load this file.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.LAUNCH_WATCH === 'off') return;
  const { maybeRunWatch } = await import('./lib/launch/watch');
  setTimeout(() => void maybeRunWatch().catch((e) => console.error('[instastudio] launch watch failed', e)), 30_000);
}
