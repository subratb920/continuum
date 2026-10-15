// src/create/catalog/web-common.js
//
// Dependencies every web framework can take as they are: an HTTP client,
// validation, end-to-end tests and formatting. They use the facts each
// template sets in ctx.meta (sources folder, dev port, public env prefix).

import { jsString, npm } from "./common.js";

const isTs = (ctx) => (ctx.options.language ?? "ts") === "ts";

/** The shared dependencies, for the given variants (others can be excluded). */
export function commonWebDependencies({ variants, axios = true }) {
  return [
    axios && {
      id: "axios",
      name: "Axios",
      description: "HTTP client with a ready API client using the API_URL setting.",
      group: "data",
      icon: "SiAxios",
      docs: "https://axios-http.com/",
      appliesTo: variants,
      packages: [npm("axios", "^1.0.0")],
      apply(ctx) {
        const name = `${ctx.meta.publicEnv ?? "VITE_"}API_URL`;
        ctx.add(
          `${ctx.meta.srcDir ?? "src"}/api.${isTs(ctx) ? "ts" : "js"}`,
          `import axios from 'axios'

// The API's address comes from ${name} (see .env.example)
export const api = axios.create({
  baseURL: ${ctx.meta.envAccess ?? "import.meta.env"}.${name},
})
`
        );
        ctx.env.push([name, "http://localhost:3000", "Address of your API"]);
      },
    },
    {
      id: "zod",
      name: "Zod",
      description: "TypeScript-first schema validation.",
      group: "forms",
      icon: "SiZod",
      docs: "https://zod.dev/",
      appliesTo: variants,
      packages: [npm("zod", "^4.0.0")],
    },
    {
      id: "playwright",
      name: "Playwright",
      description: "End-to-end tests in real browsers.",
      group: "testing",
      docs: "https://playwright.dev/",
      appliesTo: variants,
      packages: [npm("@playwright/test", "^1.0.0", true)],
      apply(ctx) {
        const ts = isTs(ctx);
        const port = ctx.meta.devPort ?? 5173;
        const dev = { npm: "npm run dev", pnpm: "pnpm dev", yarn: "yarn dev", bun: "bun run dev" }[ctx.options.packageManager ?? "npm"];
        ctx.scripts["test:e2e"] = "playwright test";
        ctx.slot("gitignoreExtra", "# Playwright\ntest-results\nplaywright-report\nblob-report");
        ctx.add(
          `playwright.config.${ts ? "ts" : "js"}`,
          `import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:${port}' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: '${ctx.meta.devCommand ?? dev}', url: 'http://localhost:${port}', reuseExistingServer: true },
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
      appliesTo: variants,
      packages: [npm("prettier", "^3.0.0", true)],
      apply(ctx) {
        if (ctx.files.has(".prettierrc")) return;
        ctx.add(".prettierrc", `${JSON.stringify({ semi: false, singleQuote: true }, null, 2)}\n`);
        ctx.add(".prettierignore", "dist\ncoverage\n");
        ctx.scripts.format = "prettier --write .";
      },
    },
  ].filter(Boolean);
}
