import { describe, it, expect } from "vitest";
import { formatMessage, escapeMd } from "../src/telegram.js";
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
    expect(msg).toContain("*Gold surges past \\$2,500*".replace("\\$", "$"));
    expect(msg).toContain("🌍");
    expect(msg).toContain("Kitco");
    expect(msg).toContain(item.link);
    expect(msg).toContain("ทองพุ่งแตะ");
  });

  it("escapes markdown specials in title", () => {
    const tricky = { ...item, title: "Gold [rises] *fast* _now_" };
    const msg = formatMessage(tricky, null);
    expect(msg).toContain("\\[rises\\]");
    expect(msg).not.toContain("*fast*");
  });

  it("works without summary", () => {
    const msg = formatMessage(item, null);
    expect(msg).toContain(item.link);
  });
});

describe("escapeMd", () => {
  it("escapes _ * [ `", () => {
    expect(escapeMd("a_b*c[d`e")).toBe("a\\_b\\*c\\[d\\`e");
  });
});

describe("stableHash", () => {
  it("is deterministic and distinct", () => {
    expect(stableHash("https://a.com/1")).toBe(stableHash("https://a.com/1"));
    expect(stableHash("https://a.com/1")).not.toBe(stableHash("https://a.com/2"));
  });
});
