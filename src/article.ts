import { guardedFetch } from "./http.js";
import { fetchArticleText as extractArticle, htmlToText } from "./extract.js";

export { htmlToText };

/**
 * Fetch article text from URL. Uses guardedFetch for SSRF protection.
 * Delegates to extract.ts for HTML parsing and text extraction.
 */
export async function fetchArticleText(
  url: string,
  maxChars = 3500,
  timeoutMs = 12000
): Promise<string | null> {
  return extractArticle(url, maxChars, timeoutMs, guardedFetch);
}
