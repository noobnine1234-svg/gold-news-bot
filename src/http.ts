import { Agent, fetch as undiciFetch } from "undici";
import { lookup } from "node:dns/promises";

export const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

const MAX_REDIRECTS = 3;

export function normalizeIp(ip: string): string {
  // IPv4-mapped IPv6 (::ffff:10.0.0.5) must be judged by its embedded v4 address
  const mapped = ip.toLowerCase().match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  return mapped ? mapped[1] : ip;
}

export function isPrivateIp(ip: string): boolean {
  const raw = normalizeIp(ip);
  const m4 = raw.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m4) {
    const [a, b] = [+m4[1], +m4[2]];
    if (a > 255 || b > 255) return true;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const l = raw.toLowerCase();
  return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80");
}

// DNS resolution happens INSIDE the connect step and only public addresses are
// handed to the socket — this pins the connection to the validated IP, closing
// both the private-address hole (incl. IPv4-mapped IPv6) and the TOCTOU
// rebinding window that validate-then-fetch has.
const ssrfAgent = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      lookup(hostname, { all: true, verbatim: options?.verbatim ?? true })
        .then((addrs) => {
          const pub = addrs.filter((a) => !isPrivateIp(a.address));
          if (!pub.length) {
            callback(new Error(`blocked: ${hostname} resolves only to private addresses`), []);
            return;
          }
          callback(null, pub);
        })
        .catch((err) => callback(err as Error, ""));
    },
  },
});

// Fetch with SSRF guard applied to every redirect hop.
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

  let res: Awaited<ReturnType<typeof undiciFetch>>;
  try {
    res = await undiciFetch(u, {
      headers: { "User-Agent": UA, Accept: accept },
      redirect: "manual",
      dispatcher: ssrfAgent,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }

  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const loc = res.headers.get("location");
    res.body?.cancel();
    if (!loc) return null;
    try {
      return guardedFetch(new URL(loc, u).toString(), timeoutMs, depth + 1, accept);
    } catch {
      return null;
    }
  }
  return res as unknown as Response;
}
