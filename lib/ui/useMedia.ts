import { useSyncExternalStore } from 'react';

/** A CSS media query as state. The server snapshot is always false, so the first client render
 *  matches the server markup; layout itself is done in CSS and never waits for this. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', notify);
      return () => mql.removeEventListener('change', notify);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}

/** Phone widths. Keep in step with the breakpoint in app/mobile.css. */
export const PHONE_QUERY = '(max-width: 767px)';

export const usePhone = () => useMedia(PHONE_QUERY);
