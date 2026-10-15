// src/create/templates/angular-svelte-static.js
//
// Angular (as `ng new` makes it: standalone, zoneless, Vitest), SvelteKit and
// Svelte + Vite (as `sv create` / create-vite make them; see NOTICE), and a
// plain HTML/CSS/JS site. The page is Continuum's starter (starter.js).

import { jsString } from "../catalog/common.js";
import { STARTER_CSS, html, included, includedHtml, json } from "./starter.js";

const describe = (ctx, fallback) => ctx.details.description || fallback;

/** A project name usable where npm scopes and dots aren't (Angular project key, folders) */
const slug = (name) => String(name).replace(/^@[^/]+\//, "").replace(/[^a-z0-9-]/g, "-");

/* ----------------------------------------------------------------- Angular */

export const angularTemplate = {
  manifest: "npm",
  prepare(ctx) {
    Object.assign(ctx.meta, { srcDir: "src", devPort: 4200, devCommand: "npm start", envAccess: null });
    for (const p of ["common", "compiler", "core", "forms", "platform-browser", "router"]) ctx.pkg("npm", `@angular/${p}`, "^22.2.0");
    ctx.pkg("npm", "rxjs", "~7.8.0");
    ctx.pkg("npm", "tslib", "^2.3.0");
    ctx.pkg("npm", "@angular/build", "^22.2.0", { dev: true });
    ctx.pkg("npm", "@angular/cli", "^22.2.0", { dev: true });
    ctx.pkg("npm", "@angular/compiler-cli", "^22.2.0", { dev: true });
    ctx.pkg("npm", "jsdom", "^30.0.0", { dev: true });
    ctx.pkg("npm", "prettier", "^3.8.0", { dev: true });
    ctx.pkg("npm", "typescript", "~6.0.2", { dev: true });
    ctx.pkg("npm", "vitest", "^5.0.0", { dev: true });
  },
  build(ctx) {
    const project = slug(ctx.details.name);
    const styles = ["src/styles.css", ...(ctx.slots.angularStyles ?? [])];
    Object.assign(ctx.scripts, { ng: "ng", start: "ng serve", build: "ng build", watch: "ng build --watch --configuration development", test: "ng test" });

    ctx.add(
      "angular.json",
      json({
        $schema: "./node_modules/@angular/cli/lib/config/schema.json",
        version: 1,
        cli: { packageManager: ctx.options.packageManager ?? "npm" },
        newProjectRoot: "projects",
        projects: {
          [project]: {
            projectType: "application",
            schematics: {},
            root: "",
            sourceRoot: "src",
            prefix: "app",
            architect: {
              build: {
                builder: "@angular/build:application",
                options: { browser: "src/main.ts", tsConfig: "tsconfig.app.json", assets: [{ glob: "**/*", input: "public" }], styles },
                configurations: {
                  production: {
                    budgets: [
                      { type: "initial", maximumWarning: "500kB", maximumError: "1MB" },
                      { type: "anyComponentStyle", maximumWarning: "4kB", maximumError: "8kB" },
                    ],
                    outputHashing: "all",
                  },
                  development: { optimization: false, extractLicenses: false, sourceMap: true },
                },
                defaultConfiguration: "production",
              },
              serve: {
                builder: "@angular/build:dev-server",
                configurations: { production: { buildTarget: `${project}:build:production` }, development: { buildTarget: `${project}:build:development` } },
                defaultConfiguration: "development",
              },
              test: { builder: "@angular/build:unit-test" },
            },
          },
        },
      })
    );
    ctx.add(
      "tsconfig.json",
      `/* To learn more about Typescript configuration file: https://www.typescriptlang.org/docs/handbook/tsconfig-json.html. */
/* To learn more about Angular compiler options: https://angular.dev/reference/configs/angular-compiler-options. */
${JSON.stringify(
  {
    compileOnSave: false,
    compilerOptions: {
      noImplicitOverride: true,
      noPropertyAccessFromIndexSignature: true,
      noImplicitReturns: true,
      noFallthroughCasesInSwitch: true,
      skipLibCheck: true,
      isolatedModules: true,
      experimentalDecorators: true,
      importHelpers: true,
      target: "ES2022",
      module: "preserve",
    },
    angularCompilerOptions: { enableI18nLegacyMessageIdFormat: false, strictInjectionParameters: true, strictInputAccessModifiers: true },
    files: [],
    references: [{ path: "./tsconfig.app.json" }, { path: "./tsconfig.spec.json" }],
  },
  null,
  2
)}
`
    );
    ctx.add("tsconfig.app.json", json({ extends: "./tsconfig.json", compilerOptions: { types: [] }, include: ["src/**/*.ts"], exclude: ["src/**/*.spec.ts"] }));
    ctx.add("tsconfig.spec.json", json({ extends: "./tsconfig.json", compilerOptions: { types: ["vitest/globals"] }, include: ["src/**/*.d.ts", "src/**/*.spec.ts"] }));
    ctx.add(
      ".gitignore",
      "# Compiled output\n/dist\n/tmp\n/out-tsc\n/bazel-out\n\n# Node\n/node_modules\nnpm-debug.log\nyarn-error.log\n\n# IDEs and editors\n.idea/\n.project\n.classpath\n.c9/\n*.launch\n.settings/\n*.sublime-workspace\n\n# Visual Studio Code\n.vscode/*\n!.vscode/settings.json\n!.vscode/tasks.json\n!.vscode/launch.json\n!.vscode/extensions.json\n.history/*\n\n# Miscellaneous\n/.angular/cache\n.sass-cache/\n/connect.lock\n/coverage\n/libpeerconnection.log\ntestem.log\n/typings\n__screenshots__/\n\n# System files\n.DS_Store\nThumbs.db\n\n# Environment (keep .env.example)\n.env\n.env.*\n!.env.example\n"
    );
    if (!ctx.files.has(".prettierrc")) {
      ctx.add(".prettierrc", json({ printWidth: 100, singleQuote: true, overrides: [{ files: "*.html", options: { parser: "angular" } }] }));
    }
    ctx.add(
      ".editorconfig",
      "# Editor configuration, see https://editorconfig.org\nroot = true\n\n[*]\ncharset = utf-8\nindent_style = space\nindent_size = 2\ninsert_final_newline = true\ntrim_trailing_whitespace = true\n\n[*.ts]\nquote_type = single\nij_typescript_use_double_quotes = false\n\n[*.md]\nmax_line_length = off\ntrim_trailing_whitespace = false\n"
    );
    ctx.add(
      "src/index.html",
      `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${html(ctx.details.name)}</title>
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/svg+xml" href="favicon.svg">
</head>
<body>
  <app-root></app-root>
</body>
</html>
`
    );
    ctx.add(
      "public/favicon.svg",
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M32 4 6 13l4 34 22 13 22-13 4-34z" fill="#dd0031"/><path d="M32 12 18 46h5l3-8h12l3 8h5zm-4 21 4-10 4 10z" fill="#fff"/></svg>\n`
    );
    ctx.add(
      "src/main.ts",
      `import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
`
    );
    const providers = ctx.slots.angularProviders ?? [];
    ctx.add(
      "src/app/app.config.ts",
      `import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
${providers.map((p) => `${p.import}\n`).join("")}import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),${providers.map((p) => `\n    ${p.call},`).join("")}
  ]
};
`
    );
    ctx.add("src/app/app.routes.ts", "import { Routes } from '@angular/router';\n\nexport const routes: Routes = [];\n");
    ctx.add(
      "src/app/app.ts",
      `import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly name = ${jsString(ctx.details.name)};
  protected readonly count = signal(0);

  protected increment(): void {
    this.count.update((c) => c + 1);
  }
}
`
    );
    ctx.add(
      "src/app/app.html",
      `<main class="app">
  <h1>{{ name }}</h1>
  <p>${html(describe(ctx, "An Angular app."))}</p>
  <p>Edit <code>src/app/app.html</code> and save to see it change.</p>
  <button type="button" class="counter" (click)="increment()">Count is {{ count() }}</button>${includedHtml(ctx, "  ")}
</main>

<router-outlet />
`
    );
    ctx.add("src/app/app.css", "");
    ctx.add("src/styles.css", `${ctx.slots.tailwind ? '@import "tailwindcss";\n\n' : ""}${STARTER_CSS}`);
    ctx.add(
      "src/app/app.spec.ts",
      `import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should show the project name', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain(${JSON.stringify(ctx.details.name)});
  });
});
`
    );
    ctx.readme.setup.push("{run} start");
    ctx.readme.notes.push("Open http://localhost:4200.", "- `{run} build` builds for production into `dist/`; `{run} test` runs the unit tests.");
  },
};

/* --------------------------------------------------------------- SvelteKit */

const SVELTE_GITIGNORE = `node_modules

# Output
.output
.vercel
.netlify
.wrangler
/.svelte-kit
/build
/dist

# OS
.DS_Store
Thumbs.db

# Env
.env
.env.*
!.env.example
!.env.test

# Vite
vite.config.js.timestamp-*
vite.config.ts.timestamp-*
`;

const SVELTE_FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 98.1 118"><path d="M91.8 15.6C80.9-.1 59.2-4.7 43.6 5.2L16.1 22.8C8.6 27.5 3.4 35.2 1.9 43.9c-1.3 7.3-.2 14.8 3.3 21.3-2.4 3.6-4 7.6-4.7 11.8-1.6 8.9.5 18.1 5.7 25.4 11 15.7 32.6 20.3 48.2 10.4l27.5-17.5c7.5-4.7 12.7-12.4 14.2-21.1 1.3-7.3.2-14.8-3.3-21.3 2.4-3.6 4-7.6 4.7-11.8 1.7-9-.4-18.2-5.7-25.5" fill="#ff3e00"/></svg>
`;

/** The page in Svelte 5 syntax (runes) */
function sveltePage(ctx, file) {
  return `<script lang="ts">
	let count = $state(0);
</script>

<svelte:head>
	<title>${html(ctx.details.name)}</title>
</svelte:head>

<main class="app">
	<h1>${html(ctx.details.name)}</h1>
	<p>${html(describe(ctx, "A Svelte app."))}</p>
	<p>Edit <code>${file}</code> and save to see it change.</p>
	<button type="button" class="counter" onclick={() => count++}>Count is {count}</button>${includedHtml(ctx, "\t")}
</main>
`;
}

export const svelteKitTemplate = {
  manifest: "npm",
  prepare(ctx) {
    Object.assign(ctx.meta, { srcDir: "src/lib", devPort: 5173, publicEnv: "PUBLIC_", envAccess: "import.meta.env" });
    ctx.pkg("npm", "@sveltejs/adapter-auto", "^8.0.0", { dev: true });
    ctx.pkg("npm", "@sveltejs/kit", "^3.0.0", { dev: true });
    ctx.pkg("npm", "@sveltejs/vite-plugin-svelte", "^7.2.0", { dev: true });
    ctx.pkg("npm", "svelte", "^5.57.0", { dev: true });
    ctx.pkg("npm", "svelte-check", "^4.6.0", { dev: true });
    ctx.pkg("npm", "typescript", "^6.0.3", { dev: true });
    ctx.pkg("npm", "vite", "^8.3.0", { dev: true });
  },
  build(ctx) {
    const tailwind = Boolean(ctx.slots.tailwind);
    Object.assign(ctx.scripts, {
      dev: "vite dev",
      build: "vite build",
      preview: "vite preview",
      prepare: "svelte-kit sync || echo ''",
      check: "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
      "check:watch": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json --watch",
    });
    ctx.slot("packageFields", { imports: { "#lib": "./src/lib/index.js", "#lib/*": "./src/lib/*" } });
    ctx.add(
      "vite.config.ts",
      `import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
${tailwind ? "import tailwindcss from '@tailwindcss/vite';\n" : ""}import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
${tailwind ? "\t\ttailwindcss(),\n" : ""}		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
			// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
			// See https://svelte.dev/docs/kit/adapters for more information about adapters.
			adapter: adapter()
		})
	]
});
`
    );
    ctx.add("tsconfig.json", `{\n\t"extends": "$app/tsconfig",\n\t"compilerOptions": {\n\t\t"strict": true\n\t},\n\t"include": ["src", "vite.config.ts"]\n}\n`);
    ctx.add(".gitignore", SVELTE_GITIGNORE);
    ctx.add(".npmrc", "engine-strict=true\n");
    ctx.add(
      "src/app.d.ts",
      "// See https://svelte.dev/docs/kit/types#app.d.ts\n// for information about these interfaces\ndeclare global {\n\tnamespace App {\n\t\t// interface Error {}\n\t\t// interface Locals {}\n\t\t// interface PageData {}\n\t\t// interface PageState {}\n\t\t// interface Platform {}\n\t}\n}\n\nexport {};\n"
    );
    ctx.add(
      "src/app.html",
      '<!doctype html>\n<html lang="en">\n\t<head>\n\t\t<meta charset="utf-8" />\n\t\t<meta name="viewport" content="width=device-width, initial-scale=1" />\n\t\t<meta name="text-scale" content="scale" />\n\t\t%sveltekit.head%\n\t</head>\n\t<body data-sveltekit-preload-data="hover">\n\t\t<div style="display: contents">%sveltekit.body%</div>\n\t</body>\n</html>\n'
    );
    ctx.add(
      "src/routes/+layout.svelte",
      `<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import '../app.css';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
`
    );
    ctx.add("src/routes/+page.svelte", sveltePage(ctx, "src/routes/+page.svelte"));
    ctx.add("src/app.css", `${tailwind ? '@import "tailwindcss";\n\n' : ""}${STARTER_CSS}`);
    ctx.add("src/lib/index.ts", "// place files you want to import through the `#lib` alias in this folder.\n");
    ctx.add("src/lib/assets/favicon.svg", SVELTE_FAVICON);
    ctx.add("static/robots.txt", "# allow crawling everything by default\nUser-agent: *\nDisallow:\n");
    ctx.readme.setup.push("{run} dev");
    ctx.readme.notes.push("Open http://localhost:5173.", "- `{run} build` builds for production; `{run} check` checks types.");
  },
};

/* ----------------------------------------------------------- Svelte + Vite */

export const svelteViteTemplate = {
  manifest: "npm",
  prepare(ctx) {
    Object.assign(ctx.meta, { srcDir: "src/lib", devPort: 5173, publicEnv: "VITE_", envAccess: "import.meta.env" });
    ctx.pkg("npm", "@sveltejs/vite-plugin-svelte", "^7.3.0", { dev: true });
    ctx.pkg("npm", "@tsconfig/svelte", "^5.0.8", { dev: true });
    ctx.pkg("npm", "@types/node", "^24.0.0", { dev: true });
    ctx.pkg("npm", "svelte", "^5.57.0", { dev: true });
    ctx.pkg("npm", "svelte-check", "^4.7.0", { dev: true });
    ctx.pkg("npm", "typescript", "~6.0.2", { dev: true });
    ctx.pkg("npm", "vite", "^8.3.0", { dev: true });
  },
  build(ctx) {
    const plugins = ctx.slots.vitePlugins ?? [];
    Object.assign(ctx.scripts, { dev: "vite", build: "vite build", preview: "vite preview", check: "svelte-check --tsconfig ./tsconfig.app.json && tsc -p tsconfig.node.json" });
    ctx.add(
      "vite.config.ts",
      `import { svelte } from '@sveltejs/vite-plugin-svelte'
${plugins.map((p) => `${p.import}\n`).join("")}import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [${["svelte()", ...plugins.map((p) => p.call)].join(", ")}],
})
`
    );
    ctx.add("svelte.config.js", '/** @type {import("@sveltejs/vite-plugin-svelte").SvelteConfig} */\nexport default {}\n');
    ctx.add("tsconfig.json", json({ files: [], references: [{ path: "./tsconfig.app.json" }, { path: "./tsconfig.node.json" }] }));
    ctx.add(
      "tsconfig.app.json",
      json({
        extends: "@tsconfig/svelte/tsconfig.json",
        compilerOptions: {
          tsBuildInfoFile: "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
          target: "es2023",
          module: "esnext",
          types: ["svelte", "vite/client"],
          allowArbitraryExtensions: true,
          noEmit: true,
          allowJs: true,
          checkJs: true,
          moduleDetection: "force",
        },
        include: ["src/**/*.ts", "src/**/*.js", "src/**/*.svelte"],
      })
    );
    ctx.add(
      "tsconfig.node.json",
      json({
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
        include: ["vite.config.ts"],
      })
    );
    ctx.add(".gitignore", SVELTE_GITIGNORE);
    ctx.add(
      "index.html",
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${html(ctx.details.name)}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`
    );
    ctx.add("public/favicon.svg", SVELTE_FAVICON);
    ctx.add(
      "src/main.ts",
      "import { mount } from 'svelte'\nimport './app.css'\nimport App from './App.svelte'\n\nconst app = mount(App, {\n  target: document.getElementById('app')!,\n})\n\nexport default app\n"
    );
    ctx.add("src/App.svelte", sveltePage(ctx, "src/App.svelte"));
    ctx.add("src/app.css", `${ctx.slots.tailwind ? '@import "tailwindcss";\n\n' : ""}${STARTER_CSS}`);
    ctx.readme.setup.push("{run} dev");
    ctx.readme.notes.push("Open http://localhost:5173.", "- `{run} build` builds for production into `dist/`; `{run} check` checks types.");
  },
};

/* ------------------------------------------------------------- Static site */

export const staticTemplate = {
  manifest: null,
  build(ctx) {
    const items = included(ctx);
    ctx.add(
      "index.html",
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${html(ctx.details.name)}</title>
    <link rel="icon" type="image/svg+xml" href="favicon.svg" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <main class="app">
      <h1>${html(ctx.details.name)}</h1>
      <p>${html(describe(ctx, "A website built with HTML, CSS and JavaScript."))}</p>
      <p>Edit <code>index.html</code> and reload to see it change.</p>
      <button type="button" class="counter" id="counter">Count is 0</button>${items.length ? includedHtml(ctx) : ""}
    </main>
    <script src="script.js"></script>
  </body>
</html>
`
    );
    ctx.add("styles.css", STARTER_CSS);
    ctx.add(
      "script.js",
      "const button = document.getElementById('counter')\nlet count = 0\n\nbutton.addEventListener('click', () => {\n  count += 1\n  button.textContent = `Count is ${count}`\n})\n"
    );
    ctx.add(
      "favicon.svg",
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M8 4h48l-4 50-20 6-20-6z" fill="#e34f26"/><path d="M32 10v45l16-5 3-40z" fill="#ef652a"/></svg>\n`
    );
    ctx.add(".gitignore", ".DS_Store\nThumbs.db\n.vscode/*\n!.vscode/extensions.json\n.idea\n");
    ctx.readme.notes.push("Open `index.html` in a browser, or serve the folder (e.g. `npx serve .` or `python3 -m http.server`).");
  },
};
