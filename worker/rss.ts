import { decodeEntities, stableHash } from "../src/text.js";
import type { FeedConfig, NewsItem } from "../src/types.js";
import { guardedFetch } from "./http.js";

const MAX_FEED_BYTES = 2_000_000;

// Minimal RSS/Atom item extraction — enough for the four feed shapes this bot
// consumes (WordPress, Dow Jones, Investing.com, Google News). Hand-rolled to
// stay inside the Workers free CPU budget (xml2js is too heavy).
export async function fetchFeed(feed: FeedConfig): Promise<NewsItem[]> {
  const xml = await fetchFeedXml(feed.url);
  if (!xml) throw new Error(`feed unavailable or too large: ${feed.url}`);
  return parseFeed(xml, feed);
}

export async function parseFeed(xml: string, feed: FeedConfig): Promise<NewsItem[]> {
  const items = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];
  const out: NewsItem[] = [];
  for (const raw of items) {
    const title = pickTag(raw, "title");
    let link = pickTag(raw, "link") || pickAttr(raw, "link", "href");
    if (!title || !link) continue;
    link = decodeEntities(link.trim());
    const dateStr = pickTag(raw, "pubDate") ?? pickTag(raw, "updated");
    const pubDate = dateStr ? new Date(dateStr) : null;
    out.push({
      hash: await stableHash(link),
      title: decodeEntities(title.replace(/<!\[CDATA\[|\]\]>/g, "").trim()),
      link,
      source: feed.name,
      lang: feed.lang,
      trusted: feed.trusted ?? false,
      pubDate: pubDate && !isNaN(pubDate.getTime()) ? pubDate : null,
    });
  }
  return out;
}

function pickTag(block: string, tag: string): string | null {
  const m =
    block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i")) ??
    block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1].trim() : null;
}

function pickAttr(block: string, tag: string, attr: string): string | null {
  const m = block.match(new RegExp(`<${tag}[^>]*\\s${attr}="([^"]+)"`, "i"));
  return m ? m[1] : null;
}

// Download through the SSRF-guarded fetch with a hard size cap.
async function fetchFeedXml(url: string): Promise<string | null> {
  const res = await guardedFetch(url, 15000);
  if (!res || !res.ok || !res.body) {
    console.warn(`[rss] miss ${url.slice(0, 60)} -> ${res ? `HTTP ${res.status}` : "no response (redirect loop/blocked)"}`);
    return null;
  }
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_FEED_BYTES) {
    try {
      res.body?.cancel();
    } catch {
      /* ignore */
    }
    return null;
  }
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let xml = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FEED_BYTES) {
      void reader.cancel();
      return null;
    }
    xml += decoder.decode(value, { stream: true });
  }
  xml += decoder.decode();
  return xml;
}
