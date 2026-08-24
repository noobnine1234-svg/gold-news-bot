import { guardedFetch } from "./http.js";
import { fetchArticleText as extractArticle } from "../src/extract.js";
import { htmlToText } from "../src/extract.js";

export { htmlToText };

export async function fetchArticleText(
  url: string,
  maxChars = 3500,
  timeoutMs = 12000
): Promise<string | null> {
  return extractArticle(url, maxChars, timeoutMs, guardedFetch);
}
