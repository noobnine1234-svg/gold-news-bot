import Parser from "rss-parser";
import { fetchArticleText } from "../src/article.js";
import { summarizeArticle } from "../src/rank.js";
process.loadEnvFile("/home/sukrit/projects/gold-news-bot/.env");
const p = new Parser();
const f = await p.parseURL("https://www.fxstreet.com/rss/news");
const g = f.items.find((i) => /gold|xau|dollar|fed/i.test(i.title));
console.log("URL:", g!.link!.slice(0, 80));
const txt = await fetchArticleText(g!.link!);
console.log("extracted:", txt ? `${txt.length} chars | ${txt.slice(0, 120).replace(/\n/g, " ")}` : null);
if (txt) {
  const s = await summarizeArticle(
    { hash: "x", title: g!.title!, link: g!.link!, source: "FXStreet", lang: "en", pubDate: null },
    txt,
    process.env.GEMINI_API_KEY!
  );
  console.log("--- THAI DEEP SUMMARY ---");
  console.log(s);
}
