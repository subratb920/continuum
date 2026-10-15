// src/create/templates/starter.js
//
// Continuum's own starter page, shared by every web template: the project's
// name and description, and the dependencies chosen with links to their docs.
// Each framework renders it in its own syntax; the look comes from STARTER_CSS.

/** The starter page's styles (light and dark, no external fonts) */
export const STARTER_CSS = `:root {
  --text: #374151;
  --text-strong: #111827;
  --muted: #6b7280;
  --bg: #ffffff;
  --border: #e5e7eb;
  --accent: #2563eb;
  --accent-text: #ffffff;

  font-family: system-ui, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.5;
  color-scheme: light dark;
  color: var(--text);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
}

@media (prefers-color-scheme: dark) {
  :root {
    --text: #d1d5db;
    --text-strong: #f9fafb;
    --muted: #9ca3af;
    --bg: #111827;
    --border: #374151;
    --accent: #60a5fa;
    --accent-text: #111827;
  }
}

body {
  margin: 0;
}

.app {
  max-width: 720px;
  margin: 0 auto;
  padding: 48px 16px;
}

.app h1 {
  margin: 0 0 8px;
  color: var(--text-strong);
  font-size: 2.25rem;
}

.app p {
  margin: 0 0 24px;
  color: var(--muted);
}

.app nav {
  display: flex;
  gap: 16px;
  margin-bottom: 24px;
}

.app a {
  color: var(--accent);
}

.counter {
  padding: 8px 16px;
  border: none;
  border-radius: 8px;
  background: var(--accent);
  color: var(--accent-text);
  font: inherit;
  cursor: pointer;
}

.included {
  margin-top: 32px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.included h2 {
  margin: 0 0 8px;
  color: var(--text-strong);
  font-size: 1rem;
}
`;

/** The chosen dependencies shown on the page: [{ name, docs }] */
export const included = (ctx) => ctx.deps.map((d) => ({ name: d.name, docs: d.docs ?? null }));

/** HTML-escaped text (for templates whose markup is HTML: Vue, Svelte, Angular, Astro, static) */
export const html = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** The "Included" list as plain HTML (frameworks with HTML templates) */
export function includedHtml(ctx, indent = "      ") {
  const items = included(ctx);
  if (!items.length) return "";
  const li = items.map((d) => `${indent}    <li>${d.docs ? `<a href="${html(d.docs)}" target="_blank" rel="noreferrer">${html(d.name)}</a>` : html(d.name)}</li>`);
  return `\n${indent}<section class="included">\n${indent}  <h2>Included</h2>\n${indent}  <ul>\n${li.join("\n")}\n${indent}  </ul>\n${indent}</section>`;
}

/** The "Included" list as JSX */
export function includedJsx(ctx, indent = "      ") {
  const items = included(ctx);
  if (!items.length) return "";
  const esc = (s) => String(s).replace(/[{}<>&]/g, (ch) => `{${JSON.stringify(ch)}}`);
  const li = items.map((d) => `${indent}    <li>${d.docs ? `<a href=${JSON.stringify(d.docs)} target="_blank" rel="noreferrer">${esc(d.name)}</a>` : esc(d.name)}</li>`);
  return `\n${indent}<section className="included">\n${indent}  <h2>Included</h2>\n${indent}  <ul>\n${li.join("\n")}\n${indent}  </ul>\n${indent}</section>`;
}

export const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

/** Run commands per package manager */
export const RUN = { npm: "npm run", pnpm: "pnpm", yarn: "yarn", bun: "bun run" };
