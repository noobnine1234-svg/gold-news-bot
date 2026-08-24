import Parser from "rss-parser";
import { createHash } from "node:crypto";

const MAX_FEED_BYTES = 2_000_000;
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

export type NewsItem = {
  hash: string;
  title: string;
  link: string;
  source: string;
  lang: "en" | "th";
  pubDate: Date | null;
};

const parser = new Parser();

export async function fetchFeed(feedUrl: string, sourceName: string, lang: "en" | "th"): Promise<NewsItem[]> {
  const xml = await fetchFeedXml(feedUrl);
  if (!xml) throw new Error(`feed unavailable or too large: ${feedUrl}`);
  const feed = await parser.parseString(xml);
  return (feed.items ?? [])
    .filter((it) => it.link && it.title)
    .map((it) => ({
      hash: stableHash(it.link!),
      title: decodeEntities(it.title!.trim()),
      link: it.link!,
      source: sourceName,
      lang,
      pubDate: it.isoDate ? new Date(it.isoDate) : it.pubDate ? new Date(it.pubDate) : null,
    }));
}

// Download with a hard size cap so a broken/malicious feed can't OOM the bot.
async function fetchFeedXml(url: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": UA },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return null;
  }
  if (!res.ok || !res.body) return null;
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_FEED_BYTES) return null;

  const reader = res.body.getReader();
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

export function stableHash(s: string): string {
  return createHash("sha1").update(s).digest("base64url").slice(0, 22);
}

export function decodeEntities(s: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => named[name.toLowerCase()] ?? m);
}
