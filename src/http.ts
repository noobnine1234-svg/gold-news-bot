import { Agent, fetch as undiciFetch } from "undici";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

const MAX_REDIRECTS = 3;

export function normalizeIp(ip: string): string {
  // Strip brackets / zone id for robustness, then judge IPv4-mapped IPv6
  // (::ffff:10.0.0.5, including expanded 0:0:0:0:0:ffff:10.0.0.5) by the
  // embedded v4 address.
  let s = ip.toLowerCase().replace(/\[|\]/g, "");
  const pct = s.indexOf("%");
  if (pct !== -1) s = s.slice(0, pct);
  const mapped = s.match(/^(?:::ffff|(?:0{1,4}:){5}ffff):(\d{1,3}(?:\.\d{1,3}){3})$/);
  return mapped ? mapped[1] : s;
}

// Parse an IPv6 literal into eight 16-bit groups; null when malformed.
// Handles "::" compression and an embedded dotted-quad tail (e.g. ::ffff:1.2.3.4).
function parseIPv6(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/\[|\]/g, "");
  const pct = s.indexOf("%");
  if (pct !== -1) s = s.slice(0, pct);
  if (s.includes("::") && s.indexOf("::") !== s.lastIndexOf("::")) return null;
  if (s.includes(".")) {
    const lastColon = s.lastIndexOf(":");
    if (lastColon === -1) return null;
    const tail = s.slice(lastColon + 1);
    const m4 = tail.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m4) return null;
    const octets = m4.slice(1).map(Number);
    if (octets.some((o) => o > 255)) return null;
    s = `${s.slice(0, lastColon)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = s.split("::");
  const head = halves[0] ? halves[0].split(":") : [];
  const tailParts = halves.length > 1 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1) {
    if (head.length !== 8) return null;
  } else if (head.length + tailParts.length > 7) {
    return null;
  }
  const groups: number[] = [];
  for (const part of head) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    groups.push(parseInt(part, 16));
  }
  if (halves.length > 1) {
    const zeros = 8 - head.length - tailParts.length;
    for (let i = 0; i < zeros; i++) groups.push(0);
    for (const part of tailParts) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      groups.push(parseInt(part, 16));
    }
  }
  return groups.length === 8 ? groups : null;
}

export function isPrivateIp(ip: string): boolean {
  const raw = normalizeIp(ip);
  const m4 = raw.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m4) {
    const [a, b, c, d] = [+m4[1], +m4[2], +m4[3], +m4[4]];
    if (a > 255 || b > 255 || c > 255 || d > 255) return true;
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
  // Anything that is not a parseable IPv6 literal here is untrusted input:
  // fail closed rather than treating it as public.
  const groups = parseIPv6(l);
  if (!groups) return true;
  if (groups.every((g) => g === 0)) return true; // unspecified "::" (any expanded form)
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true; // loopback (incl. 0:0:0:0:0:0:0:1)
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    // IPv4-mapped ::ffff:0:0/96 in hex form (dotted forms are unwrapped by
    // normalizeIp): judge the embedded v4 address.
    const v4 = `${groups[6] >>> 8}.${groups[6] & 0xff}.${groups[7] >>> 8}.${groups[7] & 0xff}`;
    return isPrivateIp(v4);
  }
  if (groups.slice(0, 6).every((g) => g === 0)) return true; // IPv4-compatible ::/96 (deprecated, reserved)
  if ((groups[0] & 0xfe00) === 0xfc00) return true; // unique-local fc00::/7
  if ((groups[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10 (full range, not just fe80)
  if ((groups[0] & 0xffc0) === 0xfec0) return true; // site-local fec0::/10 (deprecated, reserved)
  if ((groups[0] & 0xff00) === 0xff00) return true; // multicast ff00::/8
  return false;
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
  // IP-literal guard (first layer): the custom DNS lookup filter in ssrfAgent
  // is never consulted for IP literals, so reject private literals here
  // before any egress. Redirect targets recurse through guardedFetch, so
  // every hop passes this same check. URL.hostname keeps IPv6 brackets
  // ("[::1]"), which isIP would not recognise — strip them first.
  const literal = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (literal && isIP(literal) && isPrivateIp(literal)) return null;

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
