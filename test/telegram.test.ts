import { describe, it, expect } from "vitest";
import { formatMessage, escapeHtml } from "../src/telegram.js";
import { stableHash, canonicalLink } from "../src/text.js";
import type { NewsItem } from "../src/fetcher.js";

const item: NewsItem = {
  hash: "h1",
  title: "Gold surges past $2,500",
  link: "https://example.com/gold?x=1",
  source: "Kitco",
  lang: "en",
  pubDate: new Date("2026-08-24T03:00:00Z"),
};

describe("formatMessage", () => {
  it("includes title, source flag and link", () => {
    const msg = formatMessage(item, "ทองพุ่งแตะ 2,500 ดอลลาร์");
    expect(msg).toContain("<b>Gold surges past $2,500</b>");
    expect(msg).toContain("🌍");
    expect(msg).toContain("Kitco");
    expect(msg).toContain(item.link);
    expect(msg).toContain("ทองพุ่งแตะ");
  });

  it("escapes html specials in title and summary", () => {
    const tricky = { ...item, title: "Gold <rises> & shines" };
    const msg = formatMessage(tricky, "a < b & c > d");
    expect(msg).toContain("&lt;rises&gt; &amp; shines");
    expect(msg).toContain("a &lt; b &amp; c &gt; d");
    expect(msg).not.toContain("<rises>");
  });

  it("works without summary", () => {
    const msg = formatMessage(item, null);
    expect(msg).toContain(escapeHtml(item.link));
  });

  it("escapes hostile link payloads (B2 regression)", () => {
    const evil = { ...item, link: 'https://x.test/a?<script>alert(1)</script>&x="q"' };
    const msg = formatMessage(evil, null);
    expect(msg).not.toContain("<script>");
    expect(msg).toContain("&lt;script&gt;");
  });
});

describe("escapeHtml", () => {
  it("escapes & < >", () => {
    expect(escapeHtml("a&b<c>d")).toBe("a&amp;b&lt;c&gt;d");
  });
});

describe("stableHash", () => {
  it("is deterministic and distinct", async () => {
    expect(await stableHash("https://a.com/1")).toBe(await stableHash("https://a.com/1"));
    expect(await stableHash("https://a.com/1")).not.toBe(await stableHash("https://a.com/2"));
  });
});

describe("canonicalLink (aggregator wrapper churn)", () => {
  // Bing regenerates the tid param on every feed fetch, so hashing the raw
  // wrapper URL gives a fresh hash per cycle for the same story — the dedup
  // miss that re-sent identical news every 5 minutes.
  const bing1 =
    "http://www.bing.com/news/apiclick.aspx?ref=FexRss&aid=&tid=6a8cf0722d3c407680be454b7be5c40d&url=https%3a%2f%2fwww.thairath.co.th%2fnews%2fsociety%2f2954802&c=2446560124569464595&mkt=en-ww";
  const bing2 =
    "http://www.bing.com/news/apiclick.aspx?ref=FexRss&aid=&tid=6a8cf07696394346891b097ea1f748cc&url=https%3a%2f%2fwww.thairath.co.th%2fnews%2fsociety%2f2954802&c=2446560124569464595&mkt=en-ww";

  it("same article behind different wrapper params hashes identically", async () => {
    expect(canonicalLink(bing1)).toBe(canonicalLink(bing2));
    expect(await stableHash(canonicalLink(bing1))).toBe(await stableHash(canonicalLink(bing2)));
  });

  it("unwraps to the real article URL", () => {
    expect(canonicalLink(bing1)).toBe("https://www.thairath.co.th/news/society/2954802");
  });

  it("leaves direct links untouched", () => {
    expect(canonicalLink("https://www.kitco.com/news/x")).toBe("https://www.kitco.com/news/x");
  });

  it("falls back to raw link when wrapper has no url param or garbage URL", () => {
    expect(canonicalLink("https://www.bing.com/news/search?q=x")).toBe(
      "https://www.bing.com/news/search?q=x"
    );
    expect(canonicalLink("not a url at all")).toBe("not a url at all");
  });

  it("different real articles still hash differently", async () => {
    const other = bing1.replace("2954802", "9999999");
    expect(await stableHash(canonicalLink(bing1))).not.toBe(await stableHash(canonicalLink(other)));
  });
});
