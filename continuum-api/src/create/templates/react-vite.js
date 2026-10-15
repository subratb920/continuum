// src/create/templates/react-vite.js
//
// React + Vite. Configuration follows the official create-vite react and
// react-ts templates (MIT, see NOTICE); the starter page is Continuum's own.
// Dependencies fill the slots: mainImports, mainSetup, providers,
// beforeApp, vitePlugins, cssTop, testing.

import { jsString } from "../catalog/common.js";

const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

const TSCONFIG = { files: [], references: [{ path: "./tsconfig.app.json" }, { path: "./tsconfig.node.json" }] };

const TSCONFIG_APP = {
  compilerOptions: {
    tsBuildInfoFile: "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    target: "es2023",
    lib: ["ES2023", "DOM", "DOM.Iterable"],
    module: "esnext",
    types: ["vite/client"],
    allowArbitraryExtensions: true,
    skipLibCheck: true,
    moduleResolution: "bundler",
    allowImportingTsExtensions: true,
    verbatimModuleSyntax: true,
    moduleDetection: "force",
    noEmit: true,
    jsx: "react-jsx",
    noUnusedLocals: true,
    noUnusedParameters: true,
    erasableSyntaxOnly: true,
    noFallthroughCasesInSwitch: true,
  },
  include: ["src"],
};

const tsconfigNode = (include) => ({
  compilerOptions: {
    tsBuildInfoFile: "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    target: "es2023",
    lib: ["ES2023"],
    types: ["node"],
    skipLibCheck: true,
    module: "nodenext",
    allowImportingTsExtensions: true,
    verbatimModuleSyntax: true,
    moduleDetection: "force",
    noEmit: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    erasableSyntaxOnly: true,
    noFallthroughCasesInSwitch: true,
  },
  include,
});

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="none" stroke="#61dafb" stroke-width="2"/><ellipse cx="16" cy="16" rx="13" ry="5" fill="none" stroke="#61dafb" stroke-width="1.5"/><ellipse cx="16" cy="16" rx="13" ry="5" fill="none" stroke="#61dafb" stroke-width="1.5" transform="rotate(60 16 16)"/><ellipse cx="16" cy="16" rx="13" ry="5" fill="none" stroke="#61dafb" stroke-width="1.5" transform="rotate(120 16 16)"/><circle cx="16" cy="16" r="2.5" fill="#61dafb"/></svg>
`;

const INDEX_CSS = `:root {
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
`;

const APP_CSS = `.app {
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

/** The counter: with Redux, Zustand or plain React state, whichever was chosen. */
function counter(ctx, ts) {
  const ext = ts ? ".ts" : ".js";
  if (ctx.has("redux")) {
    return {
      imports: ["import { useDispatch, useSelector } from 'react-redux'", `import { increment${ts ? ", type RootState" : ""} } from './store${ext}'`],
      hooks: [`const count = useSelector((state${ts ? ": RootState" : ""}) => state.counter.value)`, "const dispatch = useDispatch()"],
      onClick: "() => dispatch(increment())",
    };
  }
  if (ctx.has("zustand")) {
    return {
      imports: [`import { useCounterStore } from './useCounterStore${ext}'`],
      hooks: ["const { count, increment } = useCounterStore()"],
      onClick: "increment",
    };
  }
  return { imports: ["import { useState } from 'react'"], hooks: ["const [count, setCount] = useState(0)"], onClick: "() => setCount((c) => c + 1)" };
}

function appFile(ctx, ts) {
  const c = counter(ctx, ts);
  const router = ctx.has("router");
  const included = ctx.deps.map((d) => ({ name: d.name, docs: d.docs }));
  const imports = [...c.imports];
  if (router) imports.push("import { Link, Route, Routes } from 'react-router'");
  imports.push("import './App.css'");

  const home = `<>
        <button type="button" className="counter" onClick={${c.onClick}}>
          Count is {count}
        </button>
      </>`;
  const body = router
    ? `<nav>
        <Link to="/">Home</Link>
        <Link to="/about">About</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Home count={count} onClick={${c.onClick}} />} />
        <Route path="/about" element={<p>{description}</p>} />
      </Routes>`
    : `<p>
        Edit <code>src/App.${ts ? "tsx" : "jsx"}</code> and save to see it change.
      </p>
      ${home}`;

  const homeComponent = router
    ? `
function Home({ count, onClick }${ts ? ": { count: number; onClick: () => void }" : ""}) {
  return (
    <>
      <p>
        Edit <code>src/App.${ts ? "tsx" : "jsx"}</code> and save to see it change.
      </p>
      <button type="button" className="counter" onClick={onClick}>
        Count is {count}
      </button>
    </>
  )
}
`
    : "";

  const includedList = included.length
    ? `
      <section className="included">
        <h2>Included</h2>
        <ul>
${included.map((d) => `          <li>${d.docs ? `<a href=${JSON.stringify(d.docs)} target="_blank" rel="noreferrer">${escapeJsx(d.name)}</a>` : escapeJsx(d.name)}</li>`).join("\n")}
        </ul>
      </section>`
    : "";

  return `${imports.join("\n")}

const name = ${jsString(ctx.details.name)}
const description = ${jsString(ctx.details.description || "A React app built with Vite.")}
${homeComponent}
function App() {
  ${c.hooks.join("\n  ")}

  return (
    <main className="app">
      <h1>{name}</h1>
      ${router ? "" : "<p>{description}</p>\n      "}${body}${includedList}
    </main>
  )
}

export default App
`;
}

const escapeJsx = (s) => String(s).replace(/[{}<>&]/g, (ch) => `{${JSON.stringify(ch)}}`);

/** Every provider except the browser router, shared by main and the tests. */
function providersFile(ctx, ts) {
  const imports = (ctx.slots.mainImports ?? []).filter((i) => !i.includes("BrowserRouter"));
  const setup = ctx.slots.mainSetup ?? [];
  const providers = (ctx.slots.providers ?? []).filter((p) => !p.open.includes("BrowserRouter"));
  const before = ctx.slots.beforeApp ?? [];
  let inner = "{children}";
  if (before.length) inner = `<>\n      ${before.join("\n      ")}\n      {children}\n    </>`;
  for (const p of [...providers].reverse()) inner = `${p.open}${inner}${p.close}`;
  const childrenType = ts ? ": { children: ReactNode }" : "";
  return `${ts ? "import type { ReactNode } from 'react'\n" : ""}${imports.join("\n")}${imports.length || ts ? "\n" : ""}
${setup.join("\n")}${setup.length ? "\n" : ""}
/** Everything the app runs inside (stores, query client, UI library…) */
export function AppProviders({ children }${childrenType}) {
  return ${providers.length || before.length ? `(\n    ${inner}\n  )` : "<>{children}</>"}
}
`;
}

function mainFile(ctx, ts) {
  const ext = ts ? "tsx" : "jsx";
  const router = ctx.has("router");
  let app = "<App />";
  app = `<AppProviders>${app}</AppProviders>`;
  if (router) app = `<BrowserRouter>${app}</BrowserRouter>`;
  return `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
${router ? "import { BrowserRouter } from 'react-router'\n" : ""}import './index.css'
import App from './App.${ext}'
import { AppProviders } from './AppProviders.${ext}'

createRoot(document.getElementById('root')${ts ? "!" : ""}).render(
  <StrictMode>
    ${app}
  </StrictMode>,
)
`;
}

function viteConfig(ctx, ts) {
  const plugins = ctx.slots.vitePlugins ?? [];
  const vitest = ctx.slots.testing?.includes("vitest");
  return `${vitest && ts ? '/// <reference types="vitest/config" />\n' : ""}import react from '@vitejs/plugin-react'
${plugins.map((p) => `${p.import}\n`).join("")}import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [${["react()", ...plugins.map((p) => p.call)].join(", ")}],${
    vitest
      ? `
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.${ts ? "ts" : "js"}'],
    exclude: ['e2e/**', 'node_modules/**'],
  },`
      : ""
  }
})
`;
}

function appTest(ctx, ts) {
  const ext = ts ? "tsx" : "jsx";
  const router = ctx.has("router");
  return `import { render, screen } from '@testing-library/react'
${router ? "import { MemoryRouter } from 'react-router'\n" : ""}import { describe, expect, it } from 'vitest'
import App from './App.${ext}'
import { AppProviders } from './AppProviders.${ext}'

describe('App', () => {
  it('shows the project name', () => {
    render(
${router ? "      <MemoryRouter>\n        <AppProviders>\n          <App />\n        </AppProviders>\n      </MemoryRouter>," : "      <AppProviders>\n        <App />\n      </AppProviders>,"}
    )
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(${jsString(ctx.details.name)})
  })
})
`;
}

export function reactViteTemplate({ gitignore }) {
  return {
    manifest: "npm",
    prepare(ctx) {
      const ts = ctx.options.language === "ts";
      Object.assign(ctx.meta, { srcDir: "src", devPort: 5173, publicEnv: "VITE_", envAccess: "import.meta.env" });
      ctx.pkg("npm", "react", "^19.2.7");
      ctx.pkg("npm", "react-dom", "^19.2.7");
      ctx.pkg("npm", "@vitejs/plugin-react", "^6.0.0", { dev: true });
      ctx.pkg("npm", "vite", "^8.0.0", { dev: true });
      ctx.pkg("npm", "oxlint", "^1.0.0", { dev: true });
      // Like the official JavaScript template too: editor hints, and npm resolves
      // the libraries' optional @types/react peers without blowing up
      ctx.pkg("npm", "@types/react", "^19.0.0", { dev: true });
      ctx.pkg("npm", "@types/react-dom", "^19.0.0", { dev: true });
      if (ts) {
        ctx.pkg("npm", "typescript", "~6.0.0", { dev: true });
        ctx.pkg("npm", "@types/node", "^24.0.0", { dev: true });
      }
    },
    build(ctx) {
      const ts = ctx.options.language === "ts";
      const ext = ts ? "tsx" : "jsx";
      const testing = ctx.slots.testing ?? [];

      ctx.scripts.dev = "vite";
      ctx.scripts.build = ts ? "tsc -b && vite build" : "vite build";
      ctx.scripts.lint = "oxlint";
      ctx.scripts.preview = "vite preview";
      if (testing.includes("vitest")) ctx.scripts.test = "vitest";
      ctx.slot("packageFields", { engines: { node: ">=22.22" } });

      ctx.add(".gitignore", gitignore);
      ctx.add(
        ".oxlintrc.json",
        json({
          $schema: "./node_modules/oxlint/configuration_schema.json",
          plugins: ts ? ["react", "typescript", "oxc"] : ["react", "oxc"],
          rules: { "react/rules-of-hooks": "error", "react/only-export-components": ["warn", { allowConstantExport: true }] },
          ignorePatterns: ["dist"],
        })
      );
      ctx.add(
        "index.html",
        `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${ctx.details.name}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.${ext}"></script>
  </body>
</html>
`
      );
      ctx.add("public/favicon.svg", FAVICON);
      ctx.add(`vite.config.${ts ? "ts" : "js"}`, viteConfig(ctx, ts));
      if (ts) {
        ctx.add("tsconfig.json", json(TSCONFIG));
        ctx.add("tsconfig.app.json", json(TSCONFIG_APP));
        ctx.add("tsconfig.node.json", json(tsconfigNode(["vite.config.ts"])));
      }
      ctx.add(`src/main.${ext}`, mainFile(ctx, ts));
      ctx.add(`src/AppProviders.${ext}`, providersFile(ctx, ts));
      ctx.add(`src/App.${ext}`, appFile(ctx, ts));
      ctx.add("src/App.css", APP_CSS);
      ctx.add("src/index.css", `${(ctx.slots.cssTop ?? []).map((l) => `${l}\n\n`).join("")}${INDEX_CSS}`);

      if (testing.includes("vitest")) {
        ctx.add(`src/test/setup.${ts ? "ts" : "js"}`, "import '@testing-library/jest-dom/vitest'\n");
        ctx.add(`src/App.test.${ext}`, appTest(ctx, ts));
      }
      ctx.readme.setup.push("{run} dev");
      ctx.readme.notes.push(
        "- `{run} build` builds for production into `dist/`.",
        "Requires Node.js 22.22 or newer."
      );
      if (testing.includes("vitest")) ctx.readme.notes.push("- `{run} test` runs the unit tests (Vitest).");
    },
  };
}
