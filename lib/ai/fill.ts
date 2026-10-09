/**
 * Pages below their category's fill target. The last page ends the post, so it may run five
 * points shorter than the rest.
 */
export function thinPages<R extends { fillPct: number }>(rs: R[], minFill: number): R[] {
  return rs.filter((r, i) => r.fillPct < (i < rs.length - 1 ? minFill : minFill - 5));
}

/** A page the flow carried over from the page before: born of a spill, not planned. */
export const isContinuation = (title: string) => / \(cont\.\)$/.test(title);
