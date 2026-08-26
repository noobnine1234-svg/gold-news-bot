import { REPUTABLE_DOMAINS } from "./sources.js";
import type { FetchFn } from "./extract.js";

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function isAllowlistedHost(host: string): boolean {
  if (!host) return false;
  return REPUTABLE_DOMAINS.some((d) => host === d || host.endsWith("." + d));
}

/** Aggregator links (Bing etc.) hide the real publisher behind a redirect. */
export function linkIsWrapped(link: string): boolean {
  const h = hostOf(link);
  return h.endsWith("bing.com") || h.includes("google.");
}

/**
 * Follow redirects (bounded, via the caller's guarded fetch) and return the
 * final URL. Returns null when unresolvable — callers must fail closed.
 */
export async function resolveFinalUrl(link: string, fetchFn: FetchFn): Promise<string | null> {
  const res = await fetchFn(link, 8000, 0, "text/html");
  if (!res || !res.ok) return null;
  try {
    const u = new URL(res.url ?? "");
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Vet a link against the allowlist. Returns the pinned final URL on success —
 * callers must fetch THAT URL for article content, never re-fetching the
 * original link (a rotating redirector could pass vetting once, then serve
 * attacker content on the next hop).
 */
export async function isReputableLink(
  item: { link: string; source: string },
  trustedFeed: boolean,
  fetchFn: FetchFn
): Promise<{ ok: true; url: string } | { ok: false }> {
  if (trustedFeed && !linkIsWrapped(item.link)) return { ok: true, url: item.link };
  const url = linkIsWrapped(item.link)
    ? await resolveFinalUrl(item.link, fetchFn)
    : item.link;
  if (!url || !isAllowlistedHost(hostOf(url))) return { ok: false };
  return { ok: true, url };
}
