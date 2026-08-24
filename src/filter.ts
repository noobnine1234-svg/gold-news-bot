import type { NewsItem } from "./fetcher.js";
import type { AppConfig } from "./config.js";

export function isGoldRelevant(item: NewsItem, kw: AppConfig["keywords"]): boolean {
  const text = item.title.toLowerCase();
  const strong = kw.strong.some((k) => text.includes(k.toLowerCase()));
  if (strong) return true;
  const weakCount = kw.weak.filter((k) => text.includes(k.toLowerCase())).length;
  return weakCount >= 2;
}
