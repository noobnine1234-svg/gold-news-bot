import Parser from "rss-parser";

export type NewsItem = {
  hash: string;
  title: string;
  link: string;
  source: string;
  lang: "en" | "th";
  pubDate: Date | null;
};

export async function fetchFeed(feedUrl: string, sourceName: string, lang: "en" | "th"): Promise<NewsItem[]> {
  const parser = new Parser({ timeout: 15000 });
  const feed = await parser.parseURL(feedUrl);
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

export function stableHash(s: string): string {
  let h1 = 0xdeadbeef ^ s.length;
  let h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function decodeEntities(s: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => named[name.toLowerCase()] ?? m);
}
