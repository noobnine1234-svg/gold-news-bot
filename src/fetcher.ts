import Parser from "rss-parser";
import { guardedFetch } from "./http.js";
import { decodeEntities, stableHash } from "./text.js";
import type { FeedConfig, NewsItem } from "./types.js";

export type { NewsItem, FeedConfig };

const MAX_FEED_BYTES = 2_000_000;

const parser = new Parser();

export async function fetchFeed(feed: FeedConfig): Promise<NewsItem[]> {
  const xml = await fetchFeedXml(feed.url);
  if (!xml) throw new Error(`feed unavailable or too large: ${feed.url}`);
  const parsed = await parser.parseString(xml);
  return (parsed.items ?? [])
    .filter((it) => it.link && it.title)
    .map(async (it) => ({
      hash: await stableHash(it.link!),
      title: decodeEntities(it.title!.trim()),
      link: it.link!,
      source: feed.name,
      lang: feed.lang,
      trusted: feed.trusted ?? false,
      pubDate: it.isoDate ? new Date(it.isoDate) : it.pubDate ? new Date(it.pubDate) : null,
    }))
    .reduce(async (acc, p) => [...(await acc), await p], Promise.resolve([] as NewsItem[]));
}

// Download through the SSRF-guarded fetch with a hard size cap so a broken or
// malicious feed can't OOM the bot.
async function fetchFeedXml(url: string): Promise<string | null> {
  const res = await guardedFetch(url, 15000, 0, "*/*");
  if (!res || !res.ok || !res.body) return null;
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_FEED_BYTES) {
    res.body?.cancel();
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
