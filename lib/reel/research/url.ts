import { createHash } from 'node:crypto';

const TRACKING_PREFIXES = ["utm_", "fbclid", "gclid", "mc_", "igshid", "ref_src", "ref_url", "si", "feature"];
const STRIPPABLE_SUBDOMAINS = ["www.", "m.", "amp.", "mobile."];

export function canonicalizeUrl(input: string): string {
  const url = new URL(input.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`unsupported protocol: ${url.protocol}`);
  }
  let host = url.hostname.toLowerCase();
  for (const prefix of STRIPPABLE_SUBDOMAINS) {
    if (host.startsWith(prefix)) { host = host.slice(prefix.length); break; }
  }
  const path = url.pathname.replace(/\/amp\/?$/i, "").replace(/\/+$/, "");
  const params = [...url.searchParams.entries()]
    .filter(([k]) => !TRACKING_PREFIXES.some((p) => k.toLowerCase().startsWith(p)))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join("&")}` : "";
  const port = url.port ? `:${url.port}` : "";
  return `${url.protocol}//${host}${port}${path}${query}`;
}

export function candidateId(canonicalUrl: string): string {
  return createHash("sha1").update(canonicalUrl).digest("hex").slice(0, 12);
}
