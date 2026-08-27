import { decodeEntities, stableHash, canonicalLink } from "./text.js";
import type { FeedConfig, NewsItem } from "./types.js";

// Minimal RSS/Atom item extraction — enough for the four feed shapes this bot
// consumes (WordPress, Dow Jones, Investing.com, Google News). Hand-rolled to
// avoid a heavy XML dependency.
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
      hash: await stableHash(canonicalLink(link)),
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
