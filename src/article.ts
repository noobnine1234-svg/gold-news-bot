import { decodeEntities } from "./fetcher.js";
import { lookup } from "node:dns/promises";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const MAX_REDIRECTS = 3;

export function isPrivateIp(ip: string): boolean {
  const m4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m4) {
    const [a, b] = [+m4[1], +m4[2]];
    if (a > 255 || b > 255) return true;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const l = ip.toLowerCase();
  return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80");
}

// SSRF guard: resolve DNS and reject private/loopback/link-local targets,
// follow redirects manually so every hop is validated.
async function safeFetch(url: string, timeoutMs: number, depth = 0): Promise<Response | null> {
  if (depth > MAX_REDIRECTS) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  try {
    const addrs = await lookup(u.hostname, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return null;
  } catch {
    return null; // unresolvable host
  }
  let res: Response;
  try {
    res = await fetch(u, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const loc = res.headers.get("location");
    res.body?.cancel();
    if (!loc) return null;
    try {
      return safeFetch(new URL(loc, u).toString(), timeoutMs, depth + 1);
    } catch {
      return null;
    }
  }
  return res;
}

export async function fetchArticleText(
  url: string,
  maxChars = 3500,
  timeoutMs = 12000
): Promise<string | null> {
  const res = await safeFetch(url, timeoutMs);
  if (!res || !res.ok) return null;
  // Google News wrapper pages render via JS — no server-side article body
  try {
    const host = new URL(res.url).hostname;
    if (host === "news.google.com" || host.endsWith(".news.google.com")) return null;
  } catch {
    return null;
  }
  const ctype = res.headers.get("content-type") ?? "";
  if (!ctype.includes("html")) return null;
  const html = await res.text();
  const text = htmlToText(html);
  if (text.length < 200) return null; // nav junk / paywall stub
  return text.slice(0, maxChars);
}

export function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|iframe|form)[\s\S]*?<\/\1>/gi, " ");
  const articleMatch = s.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch && articleMatch[1].length > 500) s = articleMatch[1];
  s = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ");
  return decodeEntities(s)
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
