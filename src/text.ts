export function decodeEntities(s: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => named[name.toLowerCase()] ?? m);
}

// Works in Node and Workers alike (WebCrypto global).
export async function stableHash(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  let bin = "";
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 22);
}

// Aggregator wrappers (Bing apiclick) carry a per-fetch tid param, so the same
// story arrives under a fresh URL every cycle — hashing the raw link defeats
// dedup. Canonical form: the real article URL when the wrapper embeds one
// (?url=<encoded>), otherwise the link unchanged.
export function canonicalLink(link: string): string {
  try {
    const u = new URL(link);
    const inner = u.searchParams.get("url");
    return inner ? inner : link;
  } catch {
    return link;
  }
}
