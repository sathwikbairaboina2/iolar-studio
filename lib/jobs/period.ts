/**
 * Period keys: an ISO week `YYYY-Www` (Monday to Sunday) or a day `YYYY-MM-DD`. The
 * board takes both; today it renders weeks and stores days.
 */

export type PeriodKind = 'weekly' | 'daily';

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** ISO week: weeks start on Monday, week 1 holds the year's first Thursday. */
export function weekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function dayKey(d: Date): string {
  return iso(d);
}

export function isWeekKey(key: string): boolean {
  return /^\d{4}-W\d{2}$/.test(key);
}

export function isDayKey(key: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(key);
}

/** The Monday of an ISO week. */
function mondayOf(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (week - 1) * 7);
  return monday;
}

export function windowFor(key: string): { from: string; to: string; kind: PeriodKind } {
  if (isWeekKey(key)) {
    const [y, w] = key.split('-W').map(Number);
    const from = mondayOf(y, w);
    const to = new Date(from);
    to.setUTCDate(from.getUTCDate() + 6);
    return { from: iso(from), to: iso(to), kind: 'weekly' };
  }
  if (isDayKey(key)) return { from: key, to: key, kind: 'daily' };
  throw new Error(`"${key}" is not a period like 2026-W36 or 2026-09-03`);
}

export function keyFor(kind: PeriodKind, now = new Date()): string {
  return kind === 'weekly' ? weekKey(now) : dayKey(now);
}
