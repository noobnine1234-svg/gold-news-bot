import { describe, it, expect } from "vitest";
import { isPrivateIp } from "../src/http.js";
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

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "169.253.1.1", "2606:4700::1111"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it("treats malformed octets as private (fail-closed)", () => {
    expect(isPrivateIp("999.1.1.1")).toBe(true);
  });
});

describe("htmlToText edge", () => {
  it("keeps working on empty input", () => {
    expect(htmlToText("")).toBe("");
  });
});
