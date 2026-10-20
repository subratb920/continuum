import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PAGES } from "../src/pages.mjs";
import { build } from "../build.mjs";

const { out } = build();
const html = (path) => readFileSync(`${out}${path === "/" ? "" : path}/index.html`, "utf8");

test("every page: a title and description search engines show in full, one h1, a canonical address", () => {
  for (const p of PAGES) {
    assert.ok(p.title.length <= 60, `${p.path} title is ${p.title.length} characters`);
    assert.ok(p.description.length >= 70 && p.description.length <= 160, `${p.path} description is ${p.description.length} characters`);
    const h = html(p.path);
    assert.equal((h.match(/<h1>/g) ?? []).length, 1, p.path);
    // The h1 reads as its words, whatever spans carry them
    assert.equal(h.match(/<h1>(.*?)<\/h1>/s)[1].replace(/<[^>]+>/g, ""), p.h1.replace(/&/g, "&amp;"), p.path);
    assert.match(h, new RegExp(`<link rel="canonical" href="https://continuum-console.one${p.path === "/" ? "/" : p.path}">`));
    assert.match(h, /<meta property="og:image" content="https:\/\/continuum-console.one\/og.png">/);
  }
});

test("titles and paths are all different (no page competes with another)", () => {
  assert.equal(new Set(PAGES.map((p) => p.title)).size, PAGES.length);
  assert.equal(new Set(PAGES.map((p) => p.path)).size, PAGES.length);
});

test("structured data parses, with the FAQ for each page that has questions", () => {
  for (const p of PAGES) {
    const blocks = [...html(p.path).matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
    assert.equal(blocks.length, 1, p.path);
    const types = blocks[0]["@graph"].map((g) => g["@type"]);
    if (p.faq?.length) assert.ok(types.includes("FAQPage"), p.path);
    assert.ok(types.includes(p.path === "/" ? "Organization" : "BreadcrumbList"), p.path);
  }
});

test("links between pages lead somewhere", () => {
  const paths = new Set(PAGES.map((p) => p.path));
  for (const p of PAGES) {
    for (const [, href] of html(p.path).matchAll(/href="(\/[^"#?]*)/g)) {
      if (/\.(css|js|png|ico)$/.test(href)) continue;
      assert.ok(paths.has(href), `${p.path} links to ${href}`);
    }
  }
});

test("sitemap lists every page; robots.txt points to it", () => {
  const sitemap = readFileSync(`${out}/sitemap.xml`, "utf8");
  for (const p of PAGES) assert.match(sitemap, new RegExp(`<loc>https://continuum-console.one${p.path === "/" ? "/" : p.path}</loc>`));
  assert.match(readFileSync(`${out}/robots.txt`, "utf8"), /Sitemap: https:\/\/continuum-console.one\/sitemap.xml/);
});
