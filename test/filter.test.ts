import { describe, it, expect } from "vitest";
import { isGoldRelevant } from "../src/filter.js";
import type { NewsItem } from "../src/types.js";
import { KEYWORDS } from "../src/sources.js";

const kw = { ...KEYWORDS };

function item(title: string): NewsItem {
  return { hash: "h", title, link: "https://x.test/a", source: "T", lang: "en", pubDate: null };
}

describe("isGoldRelevant", () => {
  it("matches strong keyword", () => {
    expect(isGoldRelevant(item("Gold price hits record high"), kw)).toBe(true);
    expect(isGoldRelevant(item("ราคาทองคำวันนี้ขึ้นพุ่ง"), kw)).toBe(true);
    expect(isGoldRelevant(item("XAUUSD breaks 2500"), kw)).toBe(true);
  });

  it("requires two weak keywords", () => {
    expect(isGoldRelevant(item("Fed hints at rate cut soon"), kw)).toBe(true);
    expect(isGoldRelevant(item("Fed meeting ends quietly"), kw)).toBe(false);
  });

  it("rejects unrelated news", () => {
    expect(isGoldRelevant(item("Premier League transfer window roundup"), kw)).toBe(false);
    expect(isGoldRelevant(item("ตลาดหุ้นไทยปิดบวก"), kw)).toBe(false);
  });
});
