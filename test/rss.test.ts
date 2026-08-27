import { describe, it, expect } from "vitest";
import { parseFeed } from "../src/rss.js";

const feed = { name: "Test", url: "https://x.test/rss", lang: "en" as const };

describe("parseFeed (mini RSS parser)", () => {
  it("parses standard RSS items with CDATA titles", async () => {
    const xml = `<rss><channel>
      <item><title><![CDATA[Gold jumps 2% to $4,600]]></title>
        <link>https://news.test/gold-1</link><pubDate>Mon, 24 Aug 2026 03:00:00 GMT</pubDate></item>
      <item><title>Silver lags</title><link>https://news.test/silver</link></item>
    </channel></rss>`;
    const items = await parseFeed(xml, feed);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Gold jumps 2% to $4,600");
    expect(items[0].link).toBe("https://news.test/gold-1");
    expect(items[0].pubDate?.getUTCFullYear()).toBe(2026);
    expect(items[0].hash).not.toBe("");
    expect(items[1].pubDate).toBeNull();
  });

  it("reads Atom <link href=...> when no plain link", async () => {
    const xml = `<feed><entry><title>Atom item</title>
      <link href="https://atom.test/a" rel="alternate"/></entry></feed>`;
    const items = await parseFeed(xml, feed);
    expect(items[0].link).toBe("https://atom.test/a");
  });

  it("decodes entities in titles and links", async () => {
    const xml = `<rss><channel><item>
      <title>Fed &amp; gold &lt;up&gt;</title>
      <link>https://x.test/?a=1&amp;b=2</link></item></channel></rss>`;
    const items = await parseFeed(xml, feed);
    expect(items[0].title).toBe('Fed & gold <up>');
    expect(items[0].link).toBe("https://x.test/?a=1&b=2");
  });

  it("skips items without link or title", async () => {
    const xml = `<rss><channel>
      <item><title>No link here</title></item>
      <item><link>https://x.test/only-link</link></item>
      <item><title>OK</title><link>https://x.test/ok</link></item>
    </channel></rss>`;
    const items = await parseFeed(xml, feed);
    expect(items.map((i) => i.link)).toEqual(["https://x.test/ok"]);
  });
});
