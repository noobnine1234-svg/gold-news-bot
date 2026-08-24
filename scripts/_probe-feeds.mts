import { guardedFetch } from "../worker/http.js";
import { parseFeed } from "../worker/rss.js";
import { FEEDS, KEYWORDS } from "../src/sources.js";
import { isGoldRelevant } from "../src/filter.js";
for (const f of FEEDS) {
  const res = await guardedFetch(f.url, 15000);
  if (!res || !res.ok) { console.log(`${f.name}: HTTP ${res?.status ?? "null"}`); continue; }
  const xml = await res.text();
  const items = await parseFeed(xml, f);
  const rel = items.filter(i => isGoldRelevant(i, KEYWORDS));
  console.log(`${f.name}: ${items.length} items, ${rel.length} relevant, sample="${items[0]?.title.slice(0,50) ?? "-"}"`);
}

