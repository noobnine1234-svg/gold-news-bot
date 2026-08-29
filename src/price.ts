import { guardedFetch } from "./http.js";

// Gold spot context for prompt enrichment — fail-open, never break the cycle.
let cached: { at: number; text: string | null } | null = null;
const CACHE_MS = 5 * 60_000;

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(n);
}

function parseGoldApiJson(j: unknown): { price: number; chgPct?: number } | null {
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  // gold-api.com: { price: 2680.12, prevClosePrice: 2665, ... } or { price: ... }
  const price = typeof o.price === "number" ? o.price : typeof (o as any).price_gram_24k === "number" ? (o as any).price_gram_24k * 31.1035 : null;
  if (typeof price !== "number" || !Number.isFinite(price)) return null;
  const prev = typeof (o as any).prevClosePrice === "number" ? (o as any).prevClosePrice : null;
  const chgPct = prev && prev !== 0 ? ((price - prev) / prev) * 100 : undefined;
  // also support { ch: 0.6 } style
  const ch = typeof (o as any).ch === "number" ? (o as any).ch : typeof (o as any).change_percent === "number" ? (o as any).change_percent : chgPct;
  return { price, chgPct: typeof ch === "number" ? ch : undefined };
}

function parseGoldpriceOrgJson(j: unknown): { price: number; chgPct?: number } | null {
  // data-asg.goldprice.org/dbXRates/USD -> { items: [{ xauPrice: 2680, xauClose: 2665, pc: 0.56 }] }
  if (!j || typeof j !== "object") return null;
  const o = j as any;
  const items = o.items;
  if (Array.isArray(items) && items[0]) {
    const it = items[0] as any;
    const price = typeof it.xauPrice === "number" ? it.xauPrice : typeof it.price === "number" ? it.price : null;
    if (typeof price === "number") {
      const chg = typeof it.pc === "number" ? it.pc : typeof it.chgPercent === "number" ? it.chgPercent : undefined;
      return { price, chgPct: chg };
    }
  }
  return null;
}

async function fetchOnce(url: string): Promise<unknown | null> {
  try {
    const res = await guardedFetch(url, 6000, 0, "application/json");
    if (!res || !res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

export async function getGoldContext(): Promise<string | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.text;
  // source 1: gold-api.com
  let parsed: { price: number; chgPct?: number } | null = null;
  const j1 = await fetchOnce("https://api.gold-api.com/price/XAU");
  if (j1) parsed = parseGoldApiJson(j1);
  // source 2 fallback
  if (!parsed) {
    const j2 = await fetchOnce("https://data-asg.goldprice.org/dbXRates/USD");
    if (j2) parsed = parseGoldpriceOrgJson(j2);
  }
  let text: string | null = null;
  if (parsed) {
    const sign = parsed.chgPct != null && parsed.chgPct > 0 ? "+" : "";
    const chg = parsed.chgPct != null ? ` ${sign}${fmt(parsed.chgPct)}% (24h)` : "";
    text = `XAU $${fmt(parsed.price)}${chg}`;
  }
  cached = { at: Date.now(), text };
  return text;
}

// test seam: reset cache
export function __resetPriceCache(): void { cached = null; }
export function __setPriceCache(text: string | null): void { cached = { at: Date.now(), text }; }
