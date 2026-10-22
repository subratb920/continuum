// continuum-site: builds the public site (dist/) from src/pages.mjs, as plain
// HTML that reads without JavaScript: what search engines and link previews
// see. Each page gets its title, description, canonical address, Open Graph
// and Twitter cards and structured data (JSON-LD); the site gets robots.txt
// and sitemap.xml. No dependencies.
//
//   SITE_URL  where the site lives (default https://continuum-console.one; www. is sent there)
//   APP_URL   Continuum itself, for Sign in (default https://app.continuum-console.one)

import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGES, SITE } from "./src/pages.mjs";
import { BLURB, LOGO, MENU, MENU_LINKS, icon } from "./src/menu.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const trim = (u) => u.replace(/\/+$/, "");
export const SITE_URL = trim(process.env.SITE_URL || "https://continuum-console.one");
export const APP_URL = trim(process.env.APP_URL || "https://app.continuum-console.one");
// Continuum's API, for the visitor beacon and the lead form (both under /public).
// Empty: the beacon and form are left out and nothing is sent.
export const API_URL = process.env.API_URL ? trim(process.env.API_URL) : "";
const OUT = join(here, "dist");
const TODAY = new Date().toISOString().slice(0, 10);
const YEAR = new Date().getFullYear();

// The stylesheet's and script's addresses carry their content's fingerprint, so a deploy is seen at once (they're kept a day)
const stamp = (file) => createHash("sha256").update(readFileSync(join(here, "static", file))).digest("hex").slice(0, 10);
const ASSET = { css: `/site.css?v=${stamp("site.css")}`, js: `/site.js?v=${stamp("site.js")}` };

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const url = (path) => (path === "/" ? `${SITE_URL}/` : `${SITE_URL}${path}`);
const byPath = (path) => PAGES.find((p) => p.path === path);
// JSON inside <script>: "<" escaped so text can never close the tag
const ld = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;

function structuredData(page) {
  const graph = [];
  if (page.path === "/") {
    graph.push(
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#org`,
        name: SITE.fullName,
        url: `${SITE_URL}/`,
        logo: `${SITE_URL}/logo-full.png`,
        email: SITE.email,
        contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: SITE.email },
      },
      { "@type": "WebSite", "@id": `${SITE_URL}/#site`, name: SITE.name, alternateName: SITE.fullName, url: `${SITE_URL}/`, publisher: { "@id": `${SITE_URL}/#org` } },
      {
        "@type": "SoftwareApplication",
        name: SITE.name,
        applicationCategory: "DeveloperApplication",
        applicationSubCategory: "AI agent orchestration IDE",
        operatingSystem: "Web browser",
        url: `${APP_URL}/`,
        description: page.description,
        featureList: PAGES.filter((p) => p.path !== "/").map((p) => p.h1),
        publisher: { "@id": `${SITE_URL}/#org` },
      }
    );
  } else {
    graph.push({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE.name, item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: page.nav, item: url(page.path) },
      ],
    });
  }
  graph.push({ "@type": "WebPage", name: page.title, url: url(page.path), description: page.description, isPartOf: { "@id": `${SITE_URL}/#site` } });
  if (page.faq?.length) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: page.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    });
  }
  return ld({ "@context": "https://schema.org", "@graph": graph });
}

const here_ = (path, current) => (path === current ? ' aria-current="page"' : "");
const CHEVRON = '<svg class="chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** A topic in the menu: its icon, name and a few words. */
const menuItem = (path, current) =>
  `<li><a class="mn-item" href="${path}"${here_(path, current)}><span class="mn-ico">${icon(path)}</span><span class="mn-text"><strong>${esc(byPath(path).nav)}</strong><span>${esc(BLURB[path])}</span></span></a></li>`;

/** The bar: each group on it, opening a panel (its topics, and one featured); then plain links. */
function menuBar(current) {
  const groups = MENU.map((g, i) => {
    const f = byPath(g.feature);
    return `<li class="mn-group">
      <button type="button" class="mn-btn" aria-expanded="false" aria-controls="mn-${i}">${esc(g.label)} ${CHEVRON}</button>
      <div class="mn-panel" id="mn-${i}">
        <div class="mn-inner">
          <div class="mn-intro">
            <p class="mn-kicker">${esc(g.label)}</p>
            <p class="mn-lead">${esc(g.lead)}</p>
            <a class="mn-feature" href="${f.path}"><span class="mn-feature-tag">Featured</span><strong>${esc(f.h1)}</strong><span class="mn-feature-go">Learn more →</span></a>
          </div>
          <ul class="mn-items">${g.items.map((p) => menuItem(p, current)).join("")}</ul>
        </div>
      </div>
    </li>`;
  }).join("");
  const links = MENU_LINKS.map((p) => `<li><a class="mn-btn" href="${p}"${here_(p, current)}>${esc(byPath(p).nav.split(" ")[0])}</a></li>`).join("");
  const contact = API_URL ? `<li><a class="mn-btn" href="/#contact">Contact</a></li>` : "";
  return `<nav class="mainnav" aria-label="Main"><ul class="mainnav-list">${groups}${links}${contact}</ul></nav>`;
}

/** Phones: one sheet with every group and topic. */
function menuSheet(current) {
  const groups = [...MENU.map((g) => ({ label: g.label, items: g.items })), { label: "Teams", items: MENU_LINKS }];
  return `<details class="msheet">
    <summary aria-label="Menu"><span class="burger" aria-hidden="true"><span></span><span></span><span></span></span></summary>
    <div class="msheet-body">${groups.map((g) => `<section><h3>${esc(g.label)}</h3><ul>${g.items.map((p) => menuItem(p, current)).join("")}</ul></section>`).join("")}
      ${API_URL ? `<section><h3>Company</h3><ul><li><a class="mn-item" href="/#contact"><span class="mn-text"><strong>Contact us</strong><span>Email us or ask for a callback</span></span></a></li></ul></section>` : ""}
      <p class="msheet-cta"><a class="btn ghost" href="${APP_URL}/signin">Sign in</a> <a class="btn" href="${APP_URL}/signin?new=1">Get started</a></p>
    </div>
  </details>`;
}

/** The footer: the same groups, as columns. */
const footerNav = (current) =>
  [...MENU.map((g) => ({ label: g.label, items: g.items })), { label: "Company", items: ["/", ...MENU_LINKS] }]
    .map((g) => `<div><h3>${esc(g.label)}</h3><ul>${g.items.map((p) => `<li><a href="${p}"${here_(p, current)}>${esc(p === "/" ? "Home" : byPath(p).nav)}</a></li>`).join("")}</ul></div>`)
    .join("");

function head({ title, description, path, noindex = false }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${url(path)}">\n<meta name="robots" content="index, follow, max-image-preview:large">`}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(SITE.fullName)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url(path)}">
<meta property="og:image" content="${SITE_URL}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(`${SITE.name}: ${SITE.tagline}`)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${SITE_URL}/og.png">
<meta name="theme-color" content="#171717" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/svg+xml" href="/logo.svg">
<link rel="apple-touch-icon" href="/icon-192.png">
<link rel="stylesheet" href="${ASSET.css}">
${API_URL ? `<meta name="api-base" content="${esc(API_URL)}">\n` : ""}<script src="${ASSET.js}" defer></script>`;
}

/** An opt-in cookie banner (only when an API is configured). Hidden until site.js shows it, and only when no choice has been made. */
function consentBanner() {
  if (!API_URL) return "";
  return `<div class="consent" data-consent hidden role="dialog" aria-label="Cookie choice">
  <p>We count visits to improve Continuum. Allow a cookie so we can recognise you on repeat visits? Either way the site works the same.</p>
  <div class="consent-actions">
    <button type="button" class="btn ghost" data-consent-no>No thanks</button>
    <button type="button" class="btn" data-consent-yes>Allow</button>
  </div>
</div>`;
}

/** A small "stay in touch" lead form (only when an API is configured). Submitted by site.js via fetch; no page reload. */
function leadForm() {
  if (!API_URL) return "";
  return `<section class="signup" id="contact" aria-labelledby="signup-h">
  <h2 id="signup-h">Contact us</h2>
  <p>Write to <a href="mailto:${SITE.email}">${esc(SITE.email)}</a>, or leave your email and we'll reach out for a callback — no spam.</p>
  <form class="signup-form" data-lead novalidate>
    <label class="visually-hidden" for="lead-email">Email</label>
    <input id="lead-email" name="email" type="email" inputmode="email" autocomplete="email" placeholder="you@company.com" required>
    <input class="hp" name="company" tabindex="-1" autocomplete="off" aria-hidden="true">
    <button type="submit" class="btn">Keep me posted</button>
    <p class="signup-msg" role="status" aria-live="polite"></p>
  </form>
</section>`;
}

function shell(page, main) {
  return `${head(page)}
${page.noindex ? "" : structuredData(page)}
</head>
<body>
<div class="progress" aria-hidden="true"></div>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <a class="brand" href="/" aria-label="${esc(SITE.fullName)} home">${LOGO(24)}<span>continuum</span></a>
  ${menuBar(page.path)}
  <span class="top-end">
    <a class="btn ghost" href="${APP_URL}/signin">Sign in</a>
    <a class="btn" href="${APP_URL}/signin?new=1">Get started</a>
  </span>
  ${menuSheet(page.path)}
</header>
<main id="main">
${main}
</main>
${page.noindex ? "" : leadForm()}
<footer class="foot">
  <div class="foot-brand"><a class="brand" href="/">${LOGO(22, "lf")}<span>continuum</span></a><p>${esc(SITE.tagline)}.</p></div>
  <nav class="foot-nav" aria-label="All topics">${footerNav(page.path)}</nav>
  <div class="foot-bottom">
    <p>© ${YEAR} ${esc(SITE.fullName)}</p>
    <p>Questions? Write to <a href="mailto:${SITE.email}">${SITE.email}</a>${API_URL ? ` or ask for a callback in <a href="/#contact">Contact us</a>` : ""}.</p>
  </div>
</footer>
${page.noindex ? "" : consentBanner()}
</body>
</html>
`;
}

/** Text as words in spans (each with its order), for word-by-word motion; reads the same without it. */
const words = (text, cls) =>
  esc(text)
    .split(" ")
    .map((w, i) => `<span class="${cls}" data-i="${i}">${w}</span>`)
    .join(" ");

/** The topics by theme, each with its page's first keywords (still on the page; they light up in reading order). */
const THEMES = [
  ["Agents and workflows", ["/ai-agent-orchestration", "/ai-workflows", "/ai-skills", "/agent-driven-development", "/ai-ide"]],
  ["Build and ship", ["/build-with-ai", "/enterprise-ai", "/mainframe-migration", "/ai-cloud-deployment", "/teams"]],
  ["Data and models", ["/data-science", "/ml-pipelines", "/machine-learning", "/custom-ai-models", "/ai-models", "/generative-ai"]],
];

/** "Continuum for …": one phrase at a time, in one place. */
const ROTATE = [
  "AI agent orchestration",
  "AI workflows",
  "mainframe migration",
  "AI-driven development",
  "enterprise systems",
  "building products with AI",
  "teams and organizations",
  "autonomous cloud deployment",
  "data science",
  "automated ML pipelines",
  "machine learning",
  "deep learning and NLP",
  "your own AI models",
  "generative AI",
  "AI agent skills",
];

function topics() {
  const seen = new Set();
  const groups = THEMES.map(([name, paths]) => {
    const chips = paths.flatMap((path) =>
      byPath(path)
        .sections.flatMap((s) => s.points)
        .slice(0, 2)
        .filter((k) => !seen.has(k) && seen.add(k))
        .map((k) => `<li><a class="chip" href="${path}">${esc(k)}</a></li>`)
    );
    return `<div class="topic-group"><h3>${esc(name)}</h3><ul>${chips.join("")}</ul></div>`;
  });
  return `<section class="topics" aria-labelledby="topics-h">
  <h2 id="topics-h" class="rotator">Continuum for <span class="rot">${ROTATE.map((n, i) => `<span class="rot-item${i ? "" : " is-on"}"${i ? ' aria-hidden="true"' : ""}>${esc(n)} </span>`).join("")}</span></h2>
  <div class="topic-groups">${groups.join("")}</div>
</section>`;
}

/** The topics in the menu's order (by theme), for the workflow run. */
const FLOW = [...MENU.flatMap((g) => g.items), ...MENU_LINKS];

/**
 * "Everything Continuum does" as a workflow run: the topics are steps on one
 * path, and as you scroll a single dot travels it, lighting each step it
 * reaches (site.js lays it out and moves the dot). Without it: a plain list.
 */
function flow() {
  return `<section class="flow" aria-labelledby="flow-h">
  <div class="flow-stage">
    <div class="flow-head"><h2 id="flow-h">Everything Continuum does</h2><p class="flow-hint">Scroll, and follow the run.</p></div>
    <div class="flow-canvas">
      <svg class="flow-svg" aria-hidden="true"><defs><linearGradient id="flow-grad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#38bdf8"/><stop offset=".5" stop-color="#818cf8"/><stop offset="1" stop-color="#f59e0b"/></linearGradient></defs><path class="flow-track"/><path class="flow-done"/><g class="flow-dot"><circle class="flow-halo" r="16"/><circle class="flow-core" r="6"/></g></svg>
      <ol class="flow-nodes">${FLOW.map((path, i) => {
        const p = byPath(path);
        return `<li class="flow-node"><a href="${path}"><span class="flow-pin">${icon(path, 18)}</span><span class="flow-label"><span class="flow-n">${String(i + 1).padStart(2, "0")}</span> ${esc(p.nav)}</span><span class="flow-bubble">${esc(BLURB[path])}<span class="flow-go">Open →</span></span></a></li>`;
      }).join("")}</ol>
      <span class="flow-mdot" aria-hidden="true"></span>
    </div>
  </div>
</section>`;
}

function pageHtml(page) {
  const sections = page.sections
    .map((s, i) => {
      const target = s.link && byPath(s.link);
      // Three columns sliding at their own speeds; each card arrives a little after the one before
      return `<section class="card" data-reveal data-speed="${[0, 0.6, 1.2][i % 3]}" data-i="${i % 3}">
  <h2>${target ? `<a href="${s.link}">${esc(s.h2)}</a>` : esc(s.h2)}</h2>
  <p>${esc(s.text)}</p>
  <ul class="points">${s.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
  ${target ? `<a class="more" href="${s.link}">Learn about ${esc(target.nav)} →</a>` : ""}
</section>`;
    })
    .join("\n");
  const faq = page.faq?.length
    ? `<section class="faq" aria-labelledby="faq-h">
  <h2 id="faq-h">Questions</h2>
  ${page.faq.map((f, i) => `<details data-reveal data-i="${i}"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("\n  ")}
</section>`
    : "";
  const others = PAGES.filter((p) => p.path !== page.path && p.path !== "/");
  const explore =
    page.path === "/"
      ? flow()
      : `<section class="explore" aria-labelledby="explore-h">
  <h2 id="explore-h" data-reveal>Explore Continuum</h2>
  <ul>${others.map((p, i) => `<li data-reveal data-i="${i % 4}"><a href="${p.path}"><strong>${esc(p.nav)}</strong><span>${esc(p.description)}</span></a></li>`).join("")}</ul>
</section>`;
  const statement = page.statement ? `<section class="statement" aria-label="In short"><p>${words(page.statement, "sw")}</p></section>` : "";
  return shell(
    page,
    `<section class="hero">
  ${page.path === "/" ? "" : `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">${SITE.name}</a> <span aria-hidden="true">/</span> ${esc(page.nav)}</nav>`}
  <p class="kicker">${esc(page.kicker)}</p>
  <h1>${words(page.h1, "w")}</h1>
  <p class="lead">${esc(page.lead)}</p>
  <p class="cta"><a class="btn big" href="${APP_URL}/signin?new=1">Get started</a> <a class="btn ghost big" href="${APP_URL}/signin">Sign in</a></p>
</section>
${topics()}
${statement}
<div class="grid">
${sections}
</div>
${faq}
${explore}
<section class="end" data-reveal>
  <h2>Ready when you are</h2>
  <p>Plan it, hand it to your AI agents, and pick up exactly where you left off.</p>
  <p class="cta"><a class="btn big" href="${APP_URL}/signin?new=1">Create an account</a></p>
</section>`
  );
}

function notFound() {
  return shell(
    { title: `Page not found | ${SITE.name}`, description: "This page doesn't exist.", path: "/404", nav: "Not found", noindex: true },
    `<section class="hero">
  <p class="kicker">404</p>
  <h1>That page doesn't exist</h1>
  <p class="lead">It may have moved. Start from the <a href="/">home page</a>, or pick a topic below.</p>
</section>
<section class="explore"><ul>${PAGES.filter((p) => p.path !== "/").map((p) => `<li><a href="${p.path}"><strong>${esc(p.nav)}</strong><span>${esc(p.description)}</span></a></li>`).join("")}</ul></section>`
  );
}

const sitemap = () =>
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${PAGES.map((p) => `  <url><loc>${url(p.path)}</loc><lastmod>${TODAY}</lastmod></url>`).join("\n")}
</urlset>
`;

const robots = () => `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`;

export function build() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  cpSync(join(here, "static"), OUT, { recursive: true });
  for (const page of PAGES) {
    const dir = page.path === "/" ? OUT : join(OUT, page.path);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), pageHtml(page));
  }
  writeFileSync(join(OUT, "404.html"), notFound());
  writeFileSync(join(OUT, "sitemap.xml"), sitemap());
  writeFileSync(join(OUT, "robots.txt"), robots());
  return { pages: PAGES.length, out: OUT };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = build();
  console.log(`continuum-site: ${r.pages} pages for ${SITE_URL} in ${r.out}`);
}
