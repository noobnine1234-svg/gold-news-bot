import { describe, it, expect } from "vitest";
import { parseRanking, isPassing, sanitizeAiText, summarizeArticle } from "../src/rank.js";

describe("isPassing", () => {
  const ranked = { a: { score: 8, summary: "" }, b: { score: 3, summary: "" } };

  it("quarantines everything when AI ranking failed (no send-all)", () => {
    expect(isPassing(null, "a", 6)).toBe(false);
  });

  it("never passes a hash the model omitted (unvetted)", () => {
    expect(isPassing(ranked, "ghost-hash", 6)).toBe(false);
  });

  it("applies threshold to scored hashes", () => {
    expect(isPassing(ranked, "a", 6)).toBe(true);
    expect(isPassing(ranked, "b", 6)).toBe(false);
    expect(isPassing(ranked, "b", 3)).toBe(true);
  });
});

describe("parseRanking", () => {
  it("parses plain JSON array", () => {
    const r = parseRanking('[{"hash":"a","score":8,"summary_th":"ทองขึ้น"},{"hash":"b","score":2,"summary_th":""}]');
    expect(r).not.toBeNull();
    expect(r!["a"]).toEqual({ score: 8, summary: "ทองขึ้น" });
    expect(r!["b"].score).toBe(2);
  });

  it("parses fenced json (```json ... ```)", () => {
    const r = parseRanking('```json\n[{"hash":"x","score":7,"summary_th":"ok"}]\n```');
    expect(r!["x"].score).toBe(7);
  });

  it("defaults bad score / missing summary fields", () => {
    const r = parseRanking('[{"hash":"q","score":"high"},{"hash":"w"}]');
    expect(r!["q"].score).toBe(0);
    expect(r!["q"].summary).toBe("");
    expect(r!["w"].score).toBe(0);
  });

  it("drops items without hash", () => {
    const r = parseRanking('[{"score":5},{"hash":"keep","score":9}]');
    expect(Object.keys(r!)).toEqual(["keep"]);
  });

  it("returns null on garbage", () => {
    expect(parseRanking("not json at all")).toBeNull();
    expect(parseRanking('{"hash":"a"}')).toBeNull();
  });

  it("returns null on empty array", () => {
    expect(parseRanking("[]")).toBeNull();
  });
});

describe("sanitizeAiText (prompt-injection output guard)", () => {
  it("strips URLs from model output", () => {
    expect(sanitizeAiText("ลงทุนเร็วที่ https://evil.io/scam ด่วน", 600)).toBe(
      "ลงทุนเร็วที่ […] ด่วน"
    );
    expect(sanitizeAiText("ดูที่ www.scam.th ครับ", 600)).toBe("ดูที่ […] ครับ");
  });

  it("strips @handles", () => {
    expect(sanitizeAiText("ติดต่อ admin @gold_admin999", 600)).toBe("ติดต่อ admin […]");
  });

  it("caps length", () => {
    expect(sanitizeAiText("x".repeat(999), 100)).toHaveLength(100);
  });

  it("leaves normal Thai summary untouched", () => {
    const s = "Fed ส่งสัญญาณหยุดขึ้นดอกเบี้ย ราคาทองขึ้น 1.2% แตะ 2450 ดอลลาร์";
    expect(sanitizeAiText(s, 600)).toBe(s);
  });
});

describe("parseRanking sanitizes summaries", () => {
  it("scrubs injected URL in summary_th", () => {
    const r = parseRanking('[{"hash":"a","score":9,"summary_th":"โปรโมชัน https://spam.io คลิก"}]');
    expect(r!["a"].summary).toBe("โปรโมชัน […] คลิก");
  });

  it("scrubs injected handles in why and caps why length", () => {
    const longWhy = `why @gold_admin999 ${"ข้อความยาว ".repeat(50)}`;
    const r = parseRanking(`[{"hash":"a","score":9,"why":"${longWhy}"}]`);
    expect(r!["a"].why!.length).toBeLessThanOrEqual(120);
    expect(r!["a"].why).not.toContain("@gold_admin999");
  });
});

describe("summarizeArticle output guard", () => {
  it("sanitizes the returned deep summary", async () => {
    // stub the network path: withModelFallback tries each model; fetch is
    // intercepted so no real API call happens
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: "สรุป: ทองขึ้น มีโปรโมชันที่ https://scam.io" }] } },
          ],
        }),
        { status: 200 }
      )) as typeof fetch;
    try {
      const out = await summarizeArticle(
        { hash: "h", title: "t", link: "https://x/", source: "s", lang: "en", trusted: true, pubDate: null },
        "article body",
        "fake-key"
      );
      expect(out).toBe("สรุป: ทองขึ้น มีโปรโมชันที่ […]");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
