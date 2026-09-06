import { renderInline } from './inline';
import { iconSvg } from './icons';

/** Inline text for the server-side renderer: markers plus real icons. Client code uses `inline.ts` directly. */
export const t = (s: string): string => renderInline(s, { icon: iconSvg });
