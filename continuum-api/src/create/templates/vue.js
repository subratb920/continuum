// src/create/templates/vue.js
//
// Vue: Vite (configuration as create-vue makes it) and Nuxt (create-nuxt
// "minimal"); see NOTICE. The page is Continuum's starter (starter.js).
// Slots: tailwind, pinia, router (Vite: dependencies asked for them),
// nuxtModules, vitePlugins, gitignoreExtra.

import { STARTER_CSS, html, includedHtml, json } from "./starter.js";

const describe = (ctx, fallback) => ctx.details.description || fallback;

const VITE_GITIGNORE = `# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

node_modules
.DS_Store
dist
dist-ssr
coverage
*.local

# Environment (keep .env.example)
.env
.env.*
!.env.example

# Editor directories and files
.vscode/*
!.vscode/extensions.json
.idea
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?

*.tsbuildinfo

.eslintcache

# Vitest
__screenshots__/

# Vite
*.timestamp-*-*.mjs
`;

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 261.76 226.69"><path d="M161.096.001l-30.225 52.351L100.647.001H-.005l130.877 226.688L261.749.001z" fill="#41b883"/><path d="M161.096.001l-30.225 52.351L100.647.001H52.346l78.526 136.01L209.398.001z" fill="#34495e"/></svg>
`;

/** The page (App.vue or app.vue): name, description, counter, included list. */
function appVue(ctx, { ts, router, pinia, nuxt }) {
  const lang = ts ? ' lang="ts"' : "";
  const counter = pinia
    ? `import { useCounterStore } from '${nuxt ? "~/stores/counter" : "@/stores/counter"}'\n\nconst counter = useCounterStore()`
    : `import { ref } from 'vue'\n\nconst count = ref(0)`;
  const button = pinia
    ? `<button type="button" class="counter" @click="counter.increment()">Count is {{ counter.count }}</button>`
    : `<button type="button" class="counter" @click="count++">Count is {{ count }}</button>`;
  const body = router
    ? `<nav>
        <RouterLink to="/">Home</RouterLink>
        <RouterLink to="/about">About</RouterLink>
      </nav>
      <RouterView />`
    : `<p>Edit <code>${nuxt ? "app/app.vue" : "src/App.vue"}</code> and save to see it change.</p>
      ${button}`;
  return `<script setup${lang}>
${router ? "import { RouterLink, RouterView } from 'vue-router'\n" : ""}${router ? "" : `${counter}\n`}</script>

<template>
  ${nuxt ? "<NuxtRouteAnnouncer />\n  " : ""}<main class="app">
      <h1>${html(ctx.details.name)}</h1>
      <p>${html(describe(ctx, nuxt ? "A Nuxt app." : "A Vue app built with Vite."))}</p>
      ${body}${includedHtml(ctx)}
  </main>
</template>
`;
}

export const vueViteTemplate = {
  manifest: "npm",
  prepare(ctx) {
    const ts = ctx.options.language === "ts";
    Object.assign(ctx.meta, { srcDir: "src", devPort: 5173, publicEnv: "VITE_", envAccess: "import.meta.env" });
    ctx.pkg("npm", "vue", "^3.5.0");
    ctx.pkg("npm", "@vitejs/plugin-vue", "^6.0.0", { dev: true });
    ctx.pkg("npm", "vite", "^8.0.0", { dev: true });
    ctx.pkg("npm", "vite-plugin-vue-devtools", "^8.0.0", { dev: true });
    if (ts) {
      ctx.pkg("npm", "typescript", "~6.0.0", { dev: true });
      ctx.pkg("npm", "vue-tsc", "^3.3.0", { dev: true });
      ctx.pkg("npm", "@vue/tsconfig", "^0.9.0", { dev: true });
      ctx.pkg("npm", "@tsconfig/node24", "^24.0.0", { dev: true });
      ctx.pkg("npm", "@types/node", "^24.0.0", { dev: true });
      ctx.pkg("npm", "npm-run-all2", "^9.0.0", { dev: true });
    }
  },
  build(ctx) {
    const ts = ctx.options.language === "ts";
    const x = ts ? "ts" : "js";
    const router = Boolean(ctx.slots.router);
    const pinia = Boolean(ctx.slots.pinia);
    const tailwind = Boolean(ctx.slots.tailwind);
    const vitest = Boolean(ctx.slots.vitest);
    const plugins = ctx.slots.vitePlugins ?? [];

    Object.assign(
      ctx.scripts,
      ts
        ? { dev: "vite", build: 'run-p type-check "build-only {@}" --', preview: "vite preview", "build-only": "vite build", "type-check": "vue-tsc --build" }
        : { dev: "vite", build: "vite build", preview: "vite preview" }
    );
    if (vitest) ctx.scripts.test = "vitest";
    ctx.slot("packageFields", { engines: { node: "^22.18.0 || >=24.12.0" } });

    ctx.add(".gitignore", VITE_GITIGNORE);
    ctx.add(
      "index.html",
      `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${html(ctx.details.name)}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.${x}"></script>
  </body>
</html>
`
    );
    ctx.add("public/favicon.svg", FAVICON);
    ctx.add(
      `vite.config.${x}`,
      `${vitest && ts ? '/// <reference types="vitest/config" />\n' : ""}import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
${plugins.map((p) => `${p.import}\n`).join("")}
// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
${plugins.map((p) => `    ${p.call},\n`).join("")}  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },${vitest ? "\n  test: {\n    environment: 'jsdom',\n    // Playwright's browser tests live in e2e/\n    exclude: ['e2e/**', 'node_modules/**'],\n  }," : ""}
})
`
    );
    if (ts) {
      ctx.add("tsconfig.json", json({ files: [], references: [{ path: "./tsconfig.node.json" }, { path: "./tsconfig.app.json" }] }));
      ctx.add(
        "tsconfig.app.json",
        json({
          extends: "@vue/tsconfig/tsconfig.dom.json",
          include: ["env.d.ts", "src/**/*", "src/**/*.vue"],
          exclude: ["src/**/__tests__/*"],
          compilerOptions: {
            noUncheckedIndexedAccess: true,
            paths: { "@/*": ["./src/*"] },
            tsBuildInfoFile: "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
          },
        })
      );
      ctx.add(
        "tsconfig.node.json",
        json({
          extends: "@tsconfig/node24/tsconfig.json",
          include: ["vite.config.*", "vitest.config.*", "playwright.config.*", "eslint.config.*"],
          compilerOptions: {
            module: "preserve",
            moduleResolution: "bundler",
            allowImportingTsExtensions: true,
            types: ["node"],
            noEmit: true,
            tsBuildInfoFile: "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
          },
        })
      );
      ctx.add("env.d.ts", '/// <reference types="vite/client" />\n');
    } else {
      ctx.add("jsconfig.json", json({ compilerOptions: { paths: { "@/*": ["./src/*"] } }, exclude: ["node_modules", "dist"] }));
    }

    const uses = [pinia && "app.use(createPinia())", router && "app.use(router)"].filter(Boolean);
    ctx.add(
      `src/main.${x}`,
      `import './assets/main.css'

import { createApp } from 'vue'
${pinia ? "import { createPinia } from 'pinia'\n" : ""}
import App from './App.vue'
${router ? "import router from './router'\n" : ""}
const app = createApp(App)
${uses.length ? `\n${uses.join("\n")}\n` : ""}
app.mount('#app')
`
    );
    ctx.add("src/App.vue", appVue(ctx, { ts, router, pinia, nuxt: false }));
    ctx.add("src/assets/main.css", `${tailwind ? '@import "tailwindcss";\n\n' : ""}${STARTER_CSS}`);
    if (pinia) {
      ctx.add(
        `src/stores/counter.${x}`,
        `import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export const useCounterStore = defineStore('counter', () => {
  const count = ref(0)
  const doubleCount = computed(() => count.value * 2)
  function increment() {
    count.value++
  }

  return { count, doubleCount, increment }
})
`
      );
    }
    if (router) {
      ctx.add(
        `src/router/index.${x}`,
        `import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
    },
    {
      path: '/about',
      name: 'about',
      // route level code-splitting: loaded when the route is visited
      component: () => import('../views/AboutView.vue'),
    },
  ],
})

export default router
`
      );
      const counter = pinia
        ? `import { useCounterStore } from '@/stores/counter'\n\nconst counter = useCounterStore()`
        : "import { ref } from 'vue'\n\nconst count = ref(0)";
      const button = pinia
        ? `<button type="button" class="counter" @click="counter.increment()">Count is {{ counter.count }}</button>`
        : `<button type="button" class="counter" @click="count++">Count is {{ count }}</button>`;
      ctx.add(
        "src/views/HomeView.vue",
        `<script setup${ts ? ' lang="ts"' : ""}>
${counter}
</script>

<template>
  <p>Edit <code>src/views/HomeView.vue</code> and save to see it change.</p>
  ${button}
</template>
`
      );
      ctx.add("src/views/AboutView.vue", `<template>\n  <p>${html(describe(ctx, "A Vue app built with Vite."))}</p>\n</template>\n`);
    }
    if (vitest) {
      ctx.add(
        `src/__tests__/App.spec.${x}`,
        `import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
${pinia ? "import { createPinia } from 'pinia'\n" : ""}${router ? "import router from '../router'\n" : ""}import App from '../App.vue'

describe('App', () => {
  it('shows the project name', () => {
    const wrapper = mount(App${pinia || router ? `, { global: { plugins: [${[pinia && "createPinia()", router && "router"].filter(Boolean).join(", ")}] } }` : ""})
    expect(wrapper.find('h1').text()).toBe(${JSON.stringify(ctx.details.name)})
  })
})
`
      );
    }
    ctx.readme.setup.push("{run} dev");
    ctx.readme.notes.push("Open http://localhost:5173.", "- `{run} build` builds for production into `dist/`.");
    if (vitest) ctx.readme.notes.push("- `{run} test` runs the unit tests (Vitest).");
  },
};

export const nuxtTemplate = {
  manifest: "npm",
  prepare(ctx) {
    Object.assign(ctx.meta, { srcDir: "app", devPort: 3000, publicEnv: "NUXT_PUBLIC_", envAccess: "process.env" });
    ctx.pkg("npm", "nuxt", "^4.6.0");
    ctx.pkg("npm", "vue", "^3.5.0");
    ctx.pkg("npm", "vue-router", "^5.4.0");
  },
  build(ctx) {
    const pinia = Boolean(ctx.slots.pinia);
    const tailwind = Boolean(ctx.slots.tailwind);
    const modules = ctx.slots.nuxtModules ?? [];
    Object.assign(ctx.scripts, { dev: "nuxt dev", build: "nuxt build", generate: "nuxt generate", preview: "nuxt preview", postinstall: "nuxt prepare" });
    // npm 10 (bundled with Node 22) fails to install Nuxt 4.6; npm 11+ works. engine-strict
    // makes an older npm stop with a clear message instead.
    ctx.slot("packageFields", { engines: { node: ">=22.12.0", npm: ">=11" } });
    ctx.add(".npmrc", "engine-strict=true\n");
    ctx.readme.notes.push("Nuxt needs npm 11 or newer (`npm install -g npm@latest`), or use pnpm, Yarn or Bun.");
    ctx.add(
      "nuxt.config.ts",
      `${tailwind ? "import tailwindcss from '@tailwindcss/vite'\n\n" : ""}// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },${modules.length ? `\n  modules: [${modules.map((m) => `'${m}'`).join(", ")}],` : ""}
  css: ['~/assets/css/main.css'],${tailwind ? "\n  vite: {\n    plugins: [tailwindcss()],\n  }," : ""}
})
`
    );
    ctx.add(
      "tsconfig.json",
      `{
  // https://nuxt.com/docs/guide/concepts/typescript
  "files": [],
  "references": [
    { "path": "./.nuxt/tsconfig.app.json" },
    { "path": "./.nuxt/tsconfig.server.json" },
    { "path": "./.nuxt/tsconfig.shared.json" },
    { "path": "./.nuxt/tsconfig.node.json" }
  ]
}
`
    );
    ctx.add(
      ".gitignore",
      "# Nuxt dev/build outputs\n.output\n.data\n.nuxt\n.nitro\n.cache\ndist\n\n# Node dependencies\nnode_modules\n\n# Logs\nlogs\n*.log\n\n# Misc\n.DS_Store\n.fleet\n.idea\n\n# Local env files\n.env\n.env.*\n!.env.example\n"
    );
    ctx.add("public/robots.txt", "User-Agent: *\nDisallow:\n");
    ctx.add("public/favicon.svg", FAVICON);
    ctx.add("app/app.vue", appVue(ctx, { ts: true, router: false, pinia, nuxt: true }));
    ctx.add("app/assets/css/main.css", `${tailwind ? '@import "tailwindcss";\n\n' : ""}${STARTER_CSS}`);
    if (pinia) {
      ctx.add(
        "app/stores/counter.ts",
        `export const useCounterStore = defineStore('counter', () => {
  const count = ref(0)
  function increment() {
    count.value++
  }

  return { count, increment }
})
`
      );
    }
    ctx.readme.setup.push("{run} dev");
    ctx.readme.notes.push("Open http://localhost:3000.", "- `{run} build` builds for production; `{run} preview` serves it.");
  },
};
