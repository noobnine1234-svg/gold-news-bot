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
 * final hostname. Returns "" when unresolvable — callers must fail closed.
 */
export async function resolveFinalHost(link: string, fetchFn: FetchFn): Promise<string> {
  const res = await fetchFn(link, 8000, 0, "text/html");
  if (!res || !res.ok) return "";
  return hostOf(res.url ?? "");
}

export async function isReputableLink(
  item: { link: string; source: string },
  trustedFeed: boolean,
  fetchFn: FetchFn
): Promise<boolean> {
  if (trustedFeed && !linkIsWrapped(item.link)) return true;
  const host = linkIsWrapped(item.link) ? await resolveFinalHost(item.link, fetchFn) : hostOf(item.link);
  return isAllowlistedHost(host);
}
