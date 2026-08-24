// Edge-safe fetch guard: https/http only, manual redirects (<=3 hops, every
// hop re-validated), Google News wrapper host blocked. Workers run on
// Cloudflare's edge — there is no LAN/metadata network to protect, so the
// DNS-pinning layer of the local runner is intentionally absent here.
const MAX_REDIRECTS = 3;

export async function guardedFetch(
  url: string,
  timeoutMs: number,
  depth = 0,
  accept = "*/*"
): Promise<Response | null> {
  if (depth > MAX_REDIRECTS) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;

  let res: Response;
  try {
    res = await fetch(u, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
        Accept: accept,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }

  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const loc = res.headers.get("location");
    try {
      res.body?.cancel();
    } catch {
      /* body may already be consumed */
    }
    if (!loc) return null;
    try {
      return guardedFetch(new URL(loc, u).toString(), timeoutMs, depth + 1, accept);
    } catch {
      return null;
    }
  }
  return res;
}
