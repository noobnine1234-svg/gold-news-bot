import Parser from "rss-parser";
import { guardedFetch } from "./http.js";
import { decodeEntities, stableHash, canonicalLink } from "./text.js";
import { readCappedStream } from "./stream.js";
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
      hash: await stableHash(canonicalLink(it.link!)),
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
  if (!res || !res.ok) return null;
  return readCappedStream(res, MAX_FEED_BYTES);
}
