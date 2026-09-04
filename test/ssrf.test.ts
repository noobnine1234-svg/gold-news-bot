import { describe, it, expect } from "vitest";
import { guardedFetch, isPrivateIp } from "../src/http.js";
import { htmlToText } from "../src/article.js";

describe("isPrivateIp", () => {
  it("blocks loopback / private / link-local ranges", () => {
    for (const ip of [
      "127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255",
      "192.168.1.1", "169.254.169.254", "0.1.2.3", "100.64.0.1",
      "::1", "::", "fc00::1", "fd12:3456::a", "fe80::1",
      "::ffff:10.0.0.5", "::ffff:192.168.1.1", "::ffff:169.254.169.254",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("blocks expanded / alternate IPv6 private forms", () => {
    for (const ip of [
      "0:0:0:0:0:0:0:1", // expanded loopback
      "0:0:0:0:0:0:0:0", // expanded unspecified
      "0000:0000:0000:0000:0000:0000:0000:0001",
      "0:0:0:0:0:ffff:10.0.0.5", // expanded IPv4-mapped private
      "0:0:0:0:0:ffff:169.254.169.254",
      "::ffff:7f00:1", // hex-form mapped loopback
      "::ffff:a00:5", // hex-form mapped private (10.0.0.5)
      "fe90::1", "fea0::1", "febf::ffff", // fe80::/10 beyond the fe80 prefix
      "FE80::1", // case-insensitive
      "ff02::1", "ff00::1", // multicast
      "fec0::1", // site-local (deprecated, reserved)
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "169.253.1.1", "2606:4700::1111"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it("treats malformed octets as private (fail-closed)", () => {
    expect(isPrivateIp("999.1.1.1")).toBe(true);
  });
});

describe("guardedFetch IP literals", () => {
  it("blocks private IP literals before egress (no DNS filter bypass)", async () => {
    for (const url of [
      "http://127.0.0.1/",
      "http://127.0.0.1:8080/internal",
      "http://10.0.0.5/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://[0:0:0:0:0:0:0:1]/",
      "http://[fe80::1]/",
      "http://[ff02::1]/",
    ]) {
      await expect(guardedFetch(url, 2000), url).resolves.toBeNull();
    }
  });
});

describe("htmlToText edge", () => {
  it("keeps working on empty input", () => {
    expect(htmlToText("")).toBe("");
  });
});
