/** Where `/` goes: the handbooks, with the query string kept so `?theme=` set by the control-room panel survives. */
export function homeTarget(searchParams: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) query.append(key, v);
  }
  const text = query.toString();
  return text ? `/handbooks?${text}` : '/handbooks';
}
