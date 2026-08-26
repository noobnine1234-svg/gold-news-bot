import { decodeEntities } from "./text.js";

export type FetchFn = (
  url: string,
  timeoutMs: number,
  depth?: number,
  accept?: string
) => Promise<Response | null>;

// Same rationale as the feed cap in fetcher.ts: a huge (or hostile) page must
// not OOM the isolate. Streamed so we bail as soon as the cap is crossed.
const MAX_ARTICLE_BYTES = 2_000_000;

async function readCapped(res: Response): Promise<string | null> {
  if (!res.body) return null;
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_ARTICLE_BYTES) {
    try {
      res.body.cancel();
    } catch {
      /* ignore */
    }
    return null;
  }
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let html = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ARTICLE_BYTES) {
      void reader.cancel();
      return null;
    }
    html += decoder.decode(value, { stream: true });
  }
  html += decoder.decode();
  return html;
}

export async function fetchArticleText(
  url: string,
  maxChars = 3500,
  timeoutMs = 12000,
  fetchFn: FetchFn
): Promise<string | null> {
  const res = await fetchFn(url, timeoutMs, 0, "text/html");
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
  const html = await readCapped(res);
  if (!html) return null;
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
