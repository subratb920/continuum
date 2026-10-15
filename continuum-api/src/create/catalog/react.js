// src/create/catalog/react.js
//
// React projects. Vite's files follow the official create-vite
// react / react-ts templates (MIT, see ../templates/NOTICE); the page itself
// is Continuum's own small starter.

import { LANGUAGE_OPTION, PACKAGE_MANAGER_OPTION, NPM_DETAILS, NODE_GITIGNORE, jsString, npm } from "./common.js";
import { reactViteTemplate } from "../templates/react-vite.js";
import { astroTemplate, gatsbyTemplate, nextTemplate, reactRouterTemplate } from "../templates/react-frameworks.js";

const ALL = ["vite", "next", "react-router", "gatsby", "astro"];
/** Libraries that need React on the page (Astro renders HTML unless a React integration is added) */
const REACT_APPS = ["vite", "next", "react-router", "gatsby"];
const src = (ctx) => ctx.meta.srcDir ?? "src";
const isTs = (ctx) => (ctx.options.language ?? "ts") === "ts";

const GROUPS = [
  { id: "routing", name: "Routing" },
  { id: "state", name: "State" },
  { id: "data", name: "Data fetching" },
  { id: "ui", name: "UI and styling" },
  { id: "forms", name: "Forms and validation" },
  { id: "testing", name: "Testing" },
  { id: "tooling", name: "Tooling" },
];

const DEPENDENCIES = [
  {
    id: "router",
    name: "React Router",
    description: "Pages and links in the browser (declarative routing).",
    group: "routing",
    icon: "SiReactrouter",
    docs: "https://reactrouter.com/",
    appliesTo: ["vite"],
    packages: [npm("react-router", "^8.0.0")],
    apply(ctx) {
      ctx.slot("mainImports", "import { BrowserRouter } from 'react-router'");
      ctx.slot("providers", { open: "<BrowserRouter>", close: "</BrowserRouter>" });
    },
  },
  {
    id: "redux",
    appliesTo: REACT_APPS,
    name: "Redux Toolkit",
    description: "A predictable global store, with React Redux bindings.",
    group: "state",
    icon: "SiRedux",
    docs: "https://redux-toolkit.js.org/",
    packages: [npm("@reduxjs/toolkit", "^2.0.0"), npm("react-redux", "^9.0.0")],
    apply(ctx) {
      const ts = isTs(ctx);
      ctx.add(
        `${src(ctx)}/store.${ts ? "ts" : "js"}`,
        `import { configureStore, createSlice } from '@reduxjs/toolkit'

const counter = createSlice({
  name: 'counter',
  initialState: { value: 0 },
  reducers: {
    increment: (state) => {
      state.value += 1
    },
  },
})

export const { increment } = counter.actions

export const store = configureStore({ reducer: { counter: counter.reducer } })
${ts ? "\nexport type RootState = ReturnType<typeof store.getState>\nexport type AppDispatch = typeof store.dispatch\n" : ""}`
      );
      ctx.slot("mainImports", "import { Provider } from 'react-redux'");
      ctx.slot("mainImports", `import { store } from './store${ts ? ".ts" : ".js"}'`);
      ctx.slot("providers", { open: "<Provider store={store}>", close: "</Provider>" });
      if (ctx.variant.id !== "vite") ctx.readme.notes.push(`Redux: the store is in \`${src(ctx)}/store.ts\`; wrap your app in \`<Provider store={store}>\` from react-redux.`);
    },
  },
  {
    id: "zustand",
    appliesTo: REACT_APPS,
    name: "Zustand",
    description: "Small, fast state stores with hooks.",
    group: "state",
    docs: "https://zustand.docs.pmnd.rs/",
    packages: [npm("zustand", "^5.0.0")],
    apply(ctx) {
      const ts = isTs(ctx);
      ctx.add(
        `${src(ctx)}/useCounterStore.${ts ? "ts" : "js"}`,
        `import { create } from 'zustand'
${ts ? "\ntype CounterState = {\n  count: number\n  increment: () => void\n}\n" : ""}
export const useCounterStore = create${ts ? "<CounterState>()" : ""}((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
}))
`
      );
    },
  },
  {
    id: "react-query",
    appliesTo: REACT_APPS,
    name: "TanStack Query",
    description: "Fetching, caching and updating server data.",
    group: "data",
    icon: "SiReactquery",
    docs: "https://tanstack.com/query/latest",
    packages: [npm("@tanstack/react-query", "^5.0.0")],
    apply(ctx) {
      ctx.slot("mainImports", "import { QueryClient, QueryClientProvider } from '@tanstack/react-query'");
      ctx.slot("mainSetup", "const queryClient = new QueryClient()");
      ctx.slot("providers", { open: "<QueryClientProvider client={queryClient}>", close: "</QueryClientProvider>" });
      if (ctx.variant.id !== "vite") ctx.readme.notes.push("TanStack Query: wrap your app in `<QueryClientProvider client={new QueryClient()}>`.");
    },
  },
  {
    id: "axios",
    name: "Axios",
    description: "HTTP client with a ready API client using the API_URL setting.",
    group: "data",
    icon: "SiAxios",
    docs: "https://axios-http.com/",
    packages: [npm("axios", "^1.0.0")],
    apply(ctx) {
      const ts = isTs(ctx);
      const name = `${ctx.meta.publicEnv ?? "VITE_"}API_URL`;
      const access = `${ctx.meta.envAccess ?? "import.meta.env"}.${name}`;
      ctx.add(
        `${src(ctx)}/api.${ts ? "ts" : "js"}`,
        `import axios from 'axios'

// The API's address comes from ${name} (see .env.example)
export const api = axios.create({
  baseURL: ${access},
})
`
      );
      ctx.env.push([name, "http://localhost:3000", "Address of your API"]);
    },
  },
  {
    id: "tailwind",
    name: "Tailwind CSS",
    description: "Utility-first CSS, wired into Vite.",
    group: "ui",
    icon: "SiTailwindcss",
    docs: "https://tailwindcss.com/docs",
    appliesTo: ["vite", "next", "react-router", "astro"],
    packages: [npm("tailwindcss", "^4.0.0", true)],
    apply(ctx) {
      ctx.slot("tailwind", true);
      if (ctx.variant.id === "next") {
        ctx.pkg("npm", "@tailwindcss/turbopack", "^4.0.0", { dev: true });
        return;
      }
      ctx.pkg("npm", "@tailwindcss/vite", "^4.0.0", { dev: true });
      ctx.slot("vitePlugins", { import: "import tailwindcss from '@tailwindcss/vite'", call: "tailwindcss()" });
      ctx.slot("cssTop", '@import "tailwindcss";');
    },
  },
  {
    id: "mui",
    appliesTo: REACT_APPS,
    name: "Material UI",
    description: "Google's Material Design components for React.",
    group: "ui",
    icon: "SiMui",
    docs: "https://mui.com/material-ui/",
    packages: [npm("@mui/material", "^9.0.0"), npm("@emotion/react", "^11.0.0"), npm("@emotion/styled", "^11.0.0")],
    apply(ctx) {
      ctx.slot("mainImports", "import CssBaseline from '@mui/material/CssBaseline'");
      ctx.slot("beforeApp", "<CssBaseline />");
    },
  },
  {
    id: "chakra",
    appliesTo: REACT_APPS,
    name: "Chakra UI",
    description: "Accessible, themeable React components.",
    group: "ui",
    icon: "SiChakraui",
    docs: "https://chakra-ui.com/",
    packages: [npm("@chakra-ui/react", "^3.0.0"), npm("@emotion/react", "^11.0.0")],
    conflicts: [{ id: "mui", reason: "two component libraries with their own styling; choose one." }],
    apply(ctx) {
      ctx.slot("mainImports", "import { ChakraProvider, defaultSystem } from '@chakra-ui/react'");
      ctx.slot("providers", { open: "<ChakraProvider value={defaultSystem}>", close: "</ChakraProvider>" });
    },
  },
  {
    id: "react-hook-form",
    appliesTo: REACT_APPS,
    name: "React Hook Form",
    description: "Performant forms with easy validation.",
    group: "forms",
    icon: "SiReacthookform",
    docs: "https://react-hook-form.com/",
    packages: [npm("react-hook-form", "^7.0.0")],
  },
  {
    id: "zod",
    name: "Zod",
    description: "TypeScript-first schema validation.",
    group: "forms",
    icon: "SiZod",
    docs: "https://zod.dev/",
    packages: [npm("zod", "^4.0.0")],
  },
  {
    id: "vitest",
    name: "Vitest + Testing Library",
    description: "Unit and component tests, with a first test for App.",
    group: "testing",
    appliesTo: ["vite"],
    icon: "SiVitest",
    docs: "https://vitest.dev/",
    packages: [
      npm("vitest", "^5.0.0", true),
      npm("jsdom", "^30.0.0", true),
      npm("@testing-library/react", "^16.0.0", true),
      npm("@testing-library/dom", "^10.0.0", true),
      npm("@testing-library/jest-dom", "^7.0.0", true),
    ],
    apply(ctx) {
      ctx.slot("testing", "vitest");
    },
  },
  {
    id: "playwright",
    name: "Playwright",
    description: "End-to-end tests in real browsers.",
    group: "testing",
    docs: "https://playwright.dev/",
    packages: [npm("@playwright/test", "^1.0.0", true)],
    apply(ctx) {
      const ts = isTs(ctx);
      const port = ctx.meta.devPort ?? 5173;
      const dev = { npm: "npm run dev", pnpm: "pnpm dev", yarn: "yarn dev", bun: "bun run dev" }[ctx.options.packageManager ?? "npm"];
      ctx.slot("testing", "playwright");
      ctx.scripts["test:e2e"] = "playwright test";
      ctx.slot("gitignoreExtra", "# Playwright\ntest-results\nplaywright-report\nblob-report");
      ctx.add(
        `playwright.config.${ts ? "ts" : "js"}`,
        `import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:${port}' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: '${dev}', url: 'http://localhost:${port}', reuseExistingServer: true },
})
`
      );
      ctx.add(
        `e2e/app.spec.${ts ? "ts" : "js"}`,
        `import { expect, test } from '@playwright/test'

test('shows the project name', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(${jsString(ctx.details.name)})
})
`
      );
      ctx.readme.notes.push("- `npx playwright install` once, then `{run} test:e2e` runs the browser tests.");
    },
  },
  {
    id: "prettier",
    name: "Prettier",
    description: "Opinionated code formatter.",
    group: "tooling",
    icon: "SiPrettier",
    docs: "https://prettier.io/",
    packages: [npm("prettier", "^3.0.0", true)],
    apply(ctx) {
      ctx.add(".prettierrc", `${JSON.stringify({ semi: false, singleQuote: true }, null, 2)}\n`);
      ctx.add(".prettierignore", "dist\ncoverage\n");
      ctx.scripts.format = "prettier --write .";
    },
  },
];

export default {
  id: "react",
  name: "React",
  icon: "SiReact",
  description: "Web user interfaces with React.",
  groups: GROUPS,
  variants: [
    {
      id: "vite",
      name: "Vite",
      icon: "SiVite",
      description: "A fast single-page app with Vite: the standard way to start with React.",
      options: [LANGUAGE_OPTION, PACKAGE_MANAGER_OPTION],
      details: NPM_DETAILS,
      template: reactViteTemplate({ gitignore: NODE_GITIGNORE }),
    },
    {
      id: "next",
      name: "Next.js",
      icon: "SiNextdotjs",
      description: "The full-stack React framework: App Router, server components, API routes.",
      options: [LANGUAGE_OPTION, PACKAGE_MANAGER_OPTION],
      details: NPM_DETAILS,
      template: nextTemplate,
    },
    {
      id: "react-router",
      name: "React Router",
      icon: "SiReactrouter",
      description: "React Router's framework mode (formerly Remix): server rendering, loaders and actions.",
      options: [PACKAGE_MANAGER_OPTION],
      details: NPM_DETAILS,
      template: reactRouterTemplate,
    },
    {
      id: "gatsby",
      name: "Gatsby",
      icon: "SiGatsby",
      description: "Static sites built with React and GraphQL.",
      options: [PACKAGE_MANAGER_OPTION],
      details: NPM_DETAILS,
      template: gatsbyTemplate,
    },
    {
      id: "astro",
      name: "Astro",
      icon: "SiAstro",
      description: "Content-focused sites that ship little JavaScript; add React islands when needed.",
      options: [PACKAGE_MANAGER_OPTION],
      details: NPM_DETAILS,
      template: astroTemplate,
    },
  ],
  dependencies: DEPENDENCIES.map((d) => ({ ...d, appliesTo: d.appliesTo ?? ALL })),
};
