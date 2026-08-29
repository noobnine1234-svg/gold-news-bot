import { describe, it, expect, vi } from "vitest";
import { summarizeArticlesBatch } from "../src/rank.js";

function mockFetchOnce(jsonText: string) {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: jsonText }] } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )) as typeof fetch;
  return () => { globalThis.fetch = orig; };
}

describe("summarizeArticlesBatch revised_score", () => {
  it("parses revised_score and returns BatchSummary", async () => {
    const restore = mockFetchOnce(
      `[{"hash":"h1","summary_th":"สรุป 1","revised_score":8},{"hash":"h2","summary_th":"สรุป 2","revised_score":3}]`
    );
    try {
      const m = await summarizeArticlesBatch(
        [
          { item: { hash: "h1", title: "t1", link: "https://x/1", source: "s", lang: "th", trusted: true, pubDate: null }, content: "c1" },
          { item: { hash: "h2", title: "t2", link: "https://x/2", source: "s", lang: "th", trusted: true, pubDate: null }, content: "c2" },
        ],
        "fake-key",
        "XAU $2680"
      );
      expect(m?.get("h1")?.revisedScore).toBe(8);
      expect(m?.get("h2")?.revisedScore).toBe(3);
      expect(m?.get("h1")?.summary).toBe("สรุป 1");
    } finally { restore(); }
  });

  it("backward compat: missing revised_score -> null", async () => {
    const restore = mockFetchOnce(`[{"hash":"h1","summary_th":"สรุป"}]`);
    try {
      const m = await summarizeArticlesBatch(
        [{ item: { hash: "h1", title: "t1", link: "https://x/1", source: "s", lang: "th", trusted: true, pubDate: null }, content: "c1" }],
        "fake-key"
      );
      expect(m?.get("h1")?.revisedScore).toBeNull();
    } finally { restore(); }
  });

  it("clamps revised_score 0-10 and ignores unknown hash", async () => {
    const restore = mockFetchOnce(`[{"hash":"unknown","summary_th":"x","revised_score":99},{"hash":"h1","summary_th":"ok","revised_score":99}]`);
    try {
      const m = await summarizeArticlesBatch(
        [{ item: { hash: "h1", title: "t1", link: "https://x/1", source: "s", lang: "th", trusted: true, pubDate: null }, content: "c1" }],
        "fake-key"
      );
      expect(m?.has("unknown")).toBe(false);
      expect(m?.get("h1")?.revisedScore).toBe(10);
    } finally { restore(); }
  });
});
