import type { FeedConfig } from "./types.js";

// Single source of truth for feeds + relevance vocabulary, shared by the local
// runner and the Cloudflare Worker.
export const FEEDS: FeedConfig[] = [
  // --- direct trusted EN sources ---
  { name: "FXStreet", url: "https://www.fxstreet.com/rss/news", lang: "en", trusted: true },
  {
    name: "MarketWatch",
    url: "https://feeds.content.dowjones.io/public/rss/mw_topstories",
    lang: "en",
    trusted: true,
  },
  { name: "Investing.com Gold", url: "https://www.investing.com/rss/news_11.rss", lang: "en", trusted: true },
  // --- direct TH sources (real article bodies for deep summaries) ---
  { name: "Thairath Money", url: "https://www.thairath.co.th/rss/money", lang: "th", trusted: true },
  { name: "Brand Inside", url: "https://www.brandinside.asia/feed/", lang: "th", trusted: true },
  // --- aggregators (multi-source discovery) ---
  // Bing News RSS: Google News returns HTTP 503 to Cloudflare Workers egress IPs.
  {
    name: "Bing News TH",
    url: "https://www.bing.com/news/search?q=%E0%B8%97%E0%B8%AD%E0%B8%87%E0%B8%84%E0%B8%B3+%E0%B8%A3%E0%B8%B2%E0%B8%84%E0%B8%B2%E0%B8%97%E0%B8%AD%E0%B8%87&format=RSS",
    lang: "th",
  },
];

// Only news from these outlets (suffix-matched, subdomains pass) may reach the
// user. Aggregator links get resolved to their final host first; anything not
// on this list — or unresolvable — is dropped (fail-closed).
export const REPUTABLE_DOMAINS = [
  // EN finance / gold majors
  "reuters.com",
  "bloomberg.com",
  "kitco.com",
  "marketwatch.com",
  "investing.com",
  "fxstreet.com",
  "cnbc.com",
  "ft.com",
  "wsj.com",
  "barrons.com",
  "apnews.com",
  "bbc.com",
  "mining.com",
  "goldprice.org",
  // Thai outlets
  "thairath.co.th",
  "brandinside.asia",
  "bangkokpost.com",
  "nationthailand.com",
  "prachachat.net",
  "mgronline.com",
  "tnnthailand.com",
  "sanook.com",
  "workpointtoday.com",
];

export const KEYWORDS = {
  strong: ["gold", "xau", "bullion", "ทองคำ", "ราคาทอง"],
  weak: [
    "fed",
    "rate cut",
    "rate hike",
    "inflation",
    "treasury",
    "dollar",
    "dollar index",
    "dxy",
    "ทองคำแท่ง",
    "ทองคำรูปสัญญา",
    "สงคราม",
    "war",
    "geopolitic",
    "central bank",
  ],
};
