import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanClient, networkOf, parseUserAgent, refererHost, visitSource, cleanPath } from "../src/activity.js";

const req = (headers = {}, ip = "203.0.113.7") => ({ ip, get: (h) => headers[h.toLowerCase()] });
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

test("activity: the browser's own details are kept short; anything else is dropped", () => {
  assert.deepEqual(cleanClient({ timezone: "Asia/Kolkata", cores: 8, touch: false, junk: { x: 1 }, screen: "x".repeat(200) }), { screen: "x".repeat(80), timezone: "Asia/Kolkata", touch: false, cores: 8 });
});

test("activity: browser, system and kind of device from the User-Agent", () => {
  assert.deepEqual(parseUserAgent(IPHONE), { browser: "Safari 17.4", os: "iOS 17.4", device: "phone" });
  assert.deepEqual(parseUserAgent(MAC_CHROME), { browser: "Chrome 131.0", os: "macOS 10.15", device: "desktop" });
  assert.equal(parseUserAgent("Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/131.0 Safari/537.36").device, "tablet");
  assert.equal(parseUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/131.0.0.0").browser, "Edge 131.0");
  assert.deepEqual(parseUserAgent(""), { browser: null, os: null, device: null });
  assert.deepEqual(parseUserAgent("curl/8.5.0"), { browser: "curl 8.5", os: null, device: "program" }, "a program isn't a device");
});

test("activity: the network a sign-in came over: IPv4/IPv6, the proxies' chain, protocol, and Google's view of the client when the load balancer adds it", () => {
  const r = { ...req({ "x-forwarded-for": "198.51.100.1, 203.0.113.7, 35.191.0.1", "x-client-subdivision": "INKA", "x-client-lat-long": "12.971599,77.594566", "x-client-rtt": "38", "x-client-tls": "TLSv1.3", "x-client-cipher": "TLS_AES_128_GCM_SHA256" }), protocol: "https", httpVersion: "1.1" };
  assert.deepEqual(networkOf(r), {
    ipVersion: 4,
    forwardedFor: ["198.51.100.1", "203.0.113.7", "35.191.0.1"],
    protocol: "https",
    httpVersion: "1.1",
    subdivision: "INKA",
    cityLatLong: "12.971599,77.594566",
    rttMs: 38,
    tlsVersion: "TLSv1.3",
    tlsCipher: "TLS_AES_128_GCM_SHA256",
  });
  assert.equal(networkOf(req({}, "2001:db8::1")).ipVersion, 6);
  assert.equal(networkOf(req({}, "::ffff:203.0.113.7")).ipVersion, 4, "an IPv4 address in IPv6 form");
  assert.equal(networkOf(req({ "x-client-lat-long": "<script>" })).cityLatLong, undefined, "only a position");
  assert.deepEqual(cleanClient({ netType: "wifi", netEffective: "4g", netDownlinkMbps: 10, netRttMs: 50, netSaveData: false }), { netType: "wifi", netEffective: "4g", netDownlinkMbps: 10, netRttMs: 50, netSaveData: false });
});

test("visit: the referrer's host, without www (bad or missing → none)", () => {
  assert.equal(refererHost("https://www.google.com/search?q=continuum"), "google.com");
  assert.equal(refererHost("https://news.ycombinator.com/item?id=1"), "news.ycombinator.com");
  assert.equal(refererHost(null), null);
  assert.equal(refererHost("not a url"), null);
});

test("visit: where a visit came from — direct, search, social or referral", () => {
  assert.equal(visitSource(null, "continuum-console.one"), "direct");
  assert.equal(visitSource("continuum-console.one", "continuum-console.one"), "direct"); // same site
  assert.equal(visitSource("google.com", "continuum-console.one"), "search");
  assert.equal(visitSource("t.co", "continuum-console.one"), "social");
  assert.equal(visitSource("linkedin.com", "continuum-console.one"), "social");
  assert.equal(visitSource("some-blog.dev", "continuum-console.one"), "referral");
});

test("visit: a path on its own — no host, query or fragment; capped", () => {
  assert.equal(cleanPath("/ai-workflows"), "/ai-workflows");
  assert.equal(cleanPath("/ai-workflows?utm=x#top"), "/ai-workflows");
  assert.equal(cleanPath("https://continuum-console.one/teams?a=1"), "/teams");
  assert.equal(cleanPath("/"), "/");
  assert.equal(cleanPath(""), null); // nothing to record
  assert.equal(cleanPath("nonsense"), null);
  assert.equal(cleanPath("/" + "a".repeat(500)).length, 200);
});
