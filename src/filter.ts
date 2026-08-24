import type { NewsItem } from "./types.js";

export type Keywords = { strong: string[]; weak: string[] };

// Relevance gate: a strong keyword passes alone; weak keywords need >=2 hits.
export function isGoldRelevant(item: NewsItem, kw: Keywords): boolean {
  const text = item.title.toLowerCase();
  const strong = kw.strong.some((k) => text.includes(k.toLowerCase()));
  if (strong) return true;
  const weakCount = kw.weak.filter((k) => text.includes(k.toLowerCase())).length;
  return weakCount >= 2;
}
