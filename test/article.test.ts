import { describe, it, expect } from "vitest";
import { htmlToText } from "../src/article.js";

describe("htmlToText", () => {
  it("strips tags and collapses whitespace", () => {
    const out = htmlToText("<p>Gold <b>rose</b>   2%</p><p>to $4,600</p>");
    expect(out).toBe("Gold rose 2%\nto $4,600");
  });

  it("removes script and style content entirely", () => {
    const out = htmlToText("<style>.x{color:red}</style><script>evil()</script><p>Real text</p>");
    expect(out).not.toContain("evil");
    expect(out).not.toContain("color:red");
    expect(out).toContain("Real text");
  });

  it("prefers article body when long enough", () => {
    const nav = "<nav>Home Menu Login</nav>";
    const body = `<article>${"<p>Sentence about gold markets.</p>".repeat(20)}</article>`;
    const out = htmlToText(`<html>${nav}${body}</html>`);
    expect(out).toContain("gold markets");
    expect(out).not.toContain("Menu Login");
  });

  it("decodes entities", () => {
    const out = htmlToText("<p>Fed &amp; gold &#36;4,600 &lt;b&gt;</p>");
    expect(out).toContain("Fed & gold $4,600 <b>");
  });
});
