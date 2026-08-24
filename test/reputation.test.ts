import { describe, it, expect } from "vitest";
import { isAllowlistedHost, hostOf, linkIsWrapped } from "../src/reputation.js";

describe("reputation allowlist", () => {
  it("accepts vetted domains and their subdomains", () => {
    expect(isAllowlistedHost("reuters.com")).toBe(true);
    expect(isAllowlistedHost("www.reuters.com")).toBe(true);
    expect(isAllowlistedHost("markets.thairath.co.th")).toBe(true);
    expect(isAllowlistedHost("fxstreet.com")).toBe(true);
  });

  it("rejects unknown / lookalike hosts (fail-closed)", () => {
    expect(isAllowlistedHost("gold-blog.xyz")).toBe(false);
    expect(isAllowlistedHost("reuters.com.evil.io")).toBe(false); // suffix must be a dot boundary
    expect(isAllowlistedHost("notreuters.com")).toBe(false);
    expect(isAllowlistedHost("")).toBe(false);
  });
});

describe("hostOf / linkIsWrapped", () => {
  it("strips www and lowercases", () => {
    expect(hostOf("https://WWW.Kitco.com/a")).toBe("kitco.com");
  });

  it("flags aggregator wrappers", () => {
    expect(linkIsWrapped("https://www.bing.com/news/apiclick.aspx?x=1")).toBe(true);
    expect(linkIsWrapped("https://news.google.com/rss/articles/xyz")).toBe(true);
    expect(linkIsWrapped("https://www.kitco.com/news/x")).toBe(false);
  });
});
