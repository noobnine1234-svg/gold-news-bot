import { describe, it, expect } from "vitest";
import { formatMessage, escapeHtml } from "../src/telegram.js";
import { stableHash } from "../src/fetcher.js";
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
    expect(msg).toContain(item.link);
  });
});

describe("escapeHtml", () => {
  it("escapes & < >", () => {
    expect(escapeHtml("a&b<c>d")).toBe("a&amp;b&lt;c&gt;d");
  });
});

describe("stableHash", () => {
  it("is deterministic and distinct", () => {
    expect(stableHash("https://a.com/1")).toBe(stableHash("https://a.com/1"));
    expect(stableHash("https://a.com/1")).not.toBe(stableHash("https://a.com/2"));
  });
});
