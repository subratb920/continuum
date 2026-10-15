// src/create/templates/react-frameworks.js
//
// React frameworks: Next.js, React Router (framework mode), Gatsby, Astro.
// Configuration follows each official starter (create-next-app,
// create-react-router, gatsby-starter-minimal-ts, create-astro "minimal";
// see NOTICE); the page is Continuum's starter (starter.js).
// Shared slots: tailwind (a dependency asked for it), gitignoreExtra.

import { jsString } from "../catalog/common.js";
import { STARTER_CSS, includedHtml, includedJsx, json } from "./starter.js";

const describe = (ctx, fallback) => ctx.details.description || fallback;

/* ------------------------------------------------------------------ Next.js */

const NEXT_GITIGNORE = `# See https://help.github.com/articles/ignoring-files/ for more about ignoring files.

# dependencies
/node_modules
/.pnp
.pnp.*
.yarn/*
!.yarn/patches
!.yarn/plugins
!.yarn/releases
!.yarn/versions

# testing
/coverage

# next.js
/.next/
/out/

# production
/build

# misc
.DS_Store
*.pem

# debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.pnpm-debug.log*

# env files (keep .env.example)
.env*
!.env.example

# vercel
.vercel

# typescript
*.tsbuildinfo
next-env.d.ts
`;

export const nextTemplate = {
  manifest: "npm",
  prepare(ctx) {
    const ts = ctx.options.language === "ts";
    Object.assign(ctx.meta, { srcDir: "src", devPort: 3000, publicEnv: "NEXT_PUBLIC_", envAccess: "process.env" });
    ctx.pkg("npm", "next", "^16.4.1");
    ctx.pkg("npm", "react", "^19.2.7");
    ctx.pkg("npm", "react-dom", "^19.2.7");
    ctx.pkg("npm", "eslint", "^9.0.0", { dev: true });
    ctx.pkg("npm", "eslint-config-next", "^16.4.1", { dev: true });
    if (ts) {
      ctx.pkg("npm", "typescript", "^5.0.0", { dev: true });
      ctx.pkg("npm", "@types/node", "^20.0.0", { dev: true });
      ctx.pkg("npm", "@types/react", "^19.0.0", { dev: true });
      ctx.pkg("npm", "@types/react-dom", "^19.0.0", { dev: true });
    }
  },
  build(ctx) {
    const ts = ctx.options.language === "ts";
    const tailwind = Boolean(ctx.slots.tailwind);
    const x = ts ? "tsx" : "js";
    Object.assign(ctx.scripts, { dev: "next dev", build: "next build", start: "next start", lint: "eslint" });

    const turbopack = tailwind
      ? `
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },`
      : "";
    ctx.add(
      ts ? "next.config.ts" : "next.config.mjs",
      `${ts ? 'import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {' : "/** @type {import('next').NextConfig} */\nconst nextConfig = {"}
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,${turbopack}
};

export default nextConfig;
`
    );
    if (ts) {
      ctx.add(
        "tsconfig.json",
        json({
          compilerOptions: {
            target: "ES2017",
            lib: ["dom", "dom.iterable", "esnext"],
            allowJs: true,
            skipLibCheck: true,
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            module: "esnext",
            moduleResolution: "bundler",
            resolveJsonModule: true,
            isolatedModules: true,
            jsx: "react-jsx",
            incremental: true,
            plugins: [{ name: "next" }],
            paths: { "@/*": ["./src/*"] },
          },
          include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts", "**/*.mts"],
          exclude: ["node_modules"],
        })
      );
    } else {
      ctx.add("jsconfig.json", json({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }));
    }
    ctx.add(
      "eslint.config.mjs",
      `import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
${ts ? 'import nextTs from "eslint-config-next/typescript";\n' : ""}
const eslintConfig = defineConfig([
  ...nextVitals,
${ts ? "  ...nextTs,\n" : ""}  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
`
    );
    ctx.add(".gitignore", NEXT_GITIGNORE);
    ctx.add(
      `src/app/layout.${x}`,
      `${ts ? 'import type { Metadata } from "next";\n' : ""}import "./globals.css";

export const metadata${ts ? ": Metadata" : ""} = {
  title: ${jsString(ctx.details.name)},
  description: ${jsString(describe(ctx, "A Next.js app"))},
};

export default function RootLayout({ children }${ts ? ': LayoutProps<"/">' : ""}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`
    );
    ctx.add(
      `src/app/page.${x}`,
      `export default function Home() {
  return (
    <main className="app">
      <h1>{${jsString(ctx.details.name)}}</h1>
      <p>{${jsString(describe(ctx, "A Next.js app."))}}</p>
      <p>
        Edit <code>src/app/page.${x}</code> and save to see it change.
      </p>${includedJsx(ctx)}
    </main>
  );
}
`
    );
    ctx.add("src/app/globals.css", `${tailwind ? '@import "tailwindcss";\n\n' : ""}${STARTER_CSS}`);
    ctx.readme.setup.push("{run} dev");
    ctx.readme.notes.push("Open http://localhost:3000.", "- `{run} build` builds for production; `{run} start` serves it.");
  },
};

/* ----------------------------------------------- React Router (framework) */

export const reactRouterTemplate = {
  manifest: "npm",
  prepare(ctx) {
    Object.assign(ctx.meta, { srcDir: "app", devPort: 5173, publicEnv: "VITE_", envAccess: "import.meta.env" });
    ctx.pkg("npm", "@react-router/node", "^8.4.0");
    ctx.pkg("npm", "@react-router/serve", "^8.4.0");
    ctx.pkg("npm", "isbot", "^5.1.0");
    ctx.pkg("npm", "react", "^19.2.7");
    ctx.pkg("npm", "react-dom", "^19.2.7");
    ctx.pkg("npm", "react-router", "^8.4.0");
    ctx.pkg("npm", "@react-router/dev", "^8.4.0", { dev: true });
    ctx.pkg("npm", "@types/node", "^22.0.0", { dev: true });
    ctx.pkg("npm", "@types/react", "^19.0.0", { dev: true });
    ctx.pkg("npm", "@types/react-dom", "^19.0.0", { dev: true });
    ctx.pkg("npm", "typescript", "^5.9.0", { dev: true });
    ctx.pkg("npm", "vite", "^8.0.0", { dev: true });
  },
  build(ctx) {
    const tailwind = Boolean(ctx.slots.tailwind);
    Object.assign(ctx.scripts, {
      dev: "react-router dev",
      build: "react-router build",
      start: "react-router-serve ./build/server/index.js",
      typecheck: "react-router typegen && tsc",
    });
    ctx.add(
      "react-router.config.ts",
      `import type { Config } from "@react-router/dev/config";

export default {
  // Server-side render by default, to enable SPA mode set this to \`false\`
  ssr: true,
} satisfies Config;
`
    );
    ctx.add(
      "vite.config.ts",
      `import { reactRouter } from "@react-router/dev/vite";
${tailwind ? 'import tailwindcss from "@tailwindcss/vite";\n' : ""}import { defineConfig } from "vite";

export default defineConfig({
  plugins: [${tailwind ? "tailwindcss(), " : ""}reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
});
`
    );
    ctx.add(
      "tsconfig.json",
      json({
        include: ["**/*", "**/.server/**/*", "**/.client/**/*", ".react-router/types/**/*"],
        compilerOptions: {
          lib: ["DOM", "DOM.Iterable", "ES2022"],
          types: ["node", "vite/client"],
          target: "ES2022",
          module: "ES2022",
          moduleResolution: "bundler",
          jsx: "react-jsx",
          rootDirs: [".", "./.react-router/types"],
          paths: { "~/*": ["./app/*"] },
          esModuleInterop: true,
          verbatimModuleSyntax: true,
          noEmit: true,
          resolveJsonModule: true,
          skipLibCheck: true,
          strict: true,
        },
      })
    );
    ctx.add(".gitignore", ".DS_Store\n.env\n/node_modules/\n\n# React Router\n/.react-router/\n/build/\n");
    ctx.add(".dockerignore", ".react-router\nbuild\nnode_modules\nREADME.md\n");
    ctx.add(
      "Dockerfile",
      `FROM node:24-alpine AS development-dependencies-env
COPY . /app
WORKDIR /app
RUN npm ci

FROM node:24-alpine AS production-dependencies-env
COPY ./package.json package-lock.json /app/
WORKDIR /app
RUN npm ci --omit=dev

FROM node:24-alpine AS build-env
COPY . /app/
COPY --from=development-dependencies-env /app/node_modules /app/node_modules
WORKDIR /app
RUN npm run build

FROM node:24-alpine
COPY ./package.json package-lock.json /app/
COPY --from=production-dependencies-env /app/node_modules /app/node_modules
COPY --from=build-env /app/build /app/build
WORKDIR /app
CMD ["npm", "run", "start"]
`
    );
    ctx.add(
      "app/root.tsx",
      `import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="app">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre>
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
`
    );
    ctx.add("app/routes.ts", `import { type RouteConfig, index } from "@react-router/dev/routes";\n\nexport default [index("routes/home.tsx")] satisfies RouteConfig;\n`);
    ctx.add(
      "app/routes/home.tsx",
      `import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: ${jsString(ctx.details.name)} },
    { name: "description", content: ${jsString(describe(ctx, "A React Router app"))} },
  ];
}

export default function Home() {
  return (
    <main className="app">
      <h1>{${jsString(ctx.details.name)}}</h1>
      <p>{${jsString(describe(ctx, "A React Router app."))}}</p>
      <p>
        Edit <code>app/routes/home.tsx</code> and save to see it change.
      </p>${includedJsx(ctx)}
    </main>
  );
}
`
    );
    ctx.add("app/app.css", `${tailwind ? '@import "tailwindcss";\n\n' : ""}${STARTER_CSS}`);
    ctx.readme.setup.push("{run} dev");
    ctx.readme.notes.push(
      "Open http://localhost:5173.",
      "- `{run} build` builds for production; `{run} start` serves it.",
      "- `{run} typecheck` checks types; a Dockerfile is included for deployment."
    );
  },
};

/* ------------------------------------------------------------------ Gatsby */

export const gatsbyTemplate = {
  manifest: "npm",
  prepare(ctx) {
    // Gatsby's server rendering still loads CommonJS: no "type": "module"
    Object.assign(ctx.meta, { srcDir: "src", devPort: 8000, publicEnv: "GATSBY_", envAccess: "process.env", packageType: "commonjs" });
    ctx.pkg("npm", "gatsby", "^5.16.0");
    ctx.pkg("npm", "react", "^19.2.7");
    ctx.pkg("npm", "react-dom", "^19.2.7");
    ctx.pkg("npm", "@types/node", "^22.0.0", { dev: true });
    ctx.pkg("npm", "@types/react", "^19.0.0", { dev: true });
    ctx.pkg("npm", "@types/react-dom", "^19.0.0", { dev: true });
    ctx.pkg("npm", "typescript", "^5.3.0", { dev: true });
  },
  build(ctx) {
    Object.assign(ctx.scripts, {
      dev: "gatsby develop",
      build: "gatsby build",
      start: "gatsby develop",
      serve: "gatsby serve",
      clean: "gatsby clean",
      typecheck: "tsc --noEmit",
    });
    ctx.slot("packageFields", { engines: { node: ">=18.0.0 <26" } });
    ctx.add(
      "gatsby-config.ts",
      `import type { GatsbyConfig } from "gatsby"

const config: GatsbyConfig = {
  siteMetadata: {
    title: ${jsString(ctx.details.name)},
    siteUrl: \`https://www.yourdomain.tld\`,
  },
  // Typed GraphQL queries: https://gatsby.dev/graphql-typegen
  graphqlTypegen: true,
  // React's automatic JSX runtime: no "import React" needed in components
  jsxRuntime: "automatic",
  plugins: [],
}

export default config
`
    );
    ctx.add(
      "tsconfig.json",
      json({
        compilerOptions: {
          target: "esnext",
          lib: ["dom", "esnext"],
          jsx: "react-jsx",
          module: "esnext",
          moduleResolution: "bundler",
          esModuleInterop: true,
          forceConsistentCasingInFileNames: true,
          strict: true,
          skipLibCheck: true,
        },
        include: ["./src/**/*", "./gatsby-node.ts", "./gatsby-config.ts", "./plugins/**/*"],
      })
    );
    ctx.add(".gitignore", "node_modules/\n.cache/\npublic\nsrc/gatsby-types.d.ts\n.env*\n!.env.example\n");
    ctx.add(
      "src/pages/index.tsx",
      `import type { HeadFC, PageProps } from "gatsby"
import type { FC } from "react"
import "../styles/global.css"

const IndexPage: FC<PageProps> = () => {
  return (
    <main className="app">
      <h1>{${jsString(ctx.details.name)}}</h1>
      <p>{${jsString(describe(ctx, "A Gatsby site."))}}</p>
      <p>
        Edit <code>src/pages/index.tsx</code> and save to see it change.
      </p>${includedJsx(ctx)}
    </main>
  )
}

export default IndexPage

export const Head: HeadFC = () => <title>{${jsString(ctx.details.name)}}</title>
`
    );
    ctx.add(
      "src/pages/404.tsx",
      `import { Link, type HeadFC, type PageProps } from "gatsby"
import type { FC } from "react"
import "../styles/global.css"

const NotFoundPage: FC<PageProps> = () => {
  return (
    <main className="app">
      <h1>Page not found</h1>
      <p>
        <Link to="/">Go home</Link>
      </p>
    </main>
  )
}

export default NotFoundPage

export const Head: HeadFC = () => <title>Not found</title>
`
    );
    ctx.add("src/styles/global.css", STARTER_CSS);
    ctx.readme.setup.push("{run} dev");
    ctx.readme.notes.push("Open http://localhost:8000.", "- `{run} build` builds the static site into `public/`; `{run} serve` serves it.");
  },
};

/* ------------------------------------------------------------------- Astro */

export const astroTemplate = {
  manifest: "npm",
  prepare(ctx) {
    Object.assign(ctx.meta, { srcDir: "src", devPort: 4321, publicEnv: "PUBLIC_", envAccess: "import.meta.env" });
    ctx.pkg("npm", "astro", "^7.3.0");
  },
  build(ctx) {
    const tailwind = Boolean(ctx.slots.tailwind);
    Object.assign(ctx.scripts, { dev: "astro dev", build: "astro build", preview: "astro preview", astro: "astro" });
    ctx.slot("packageFields", { engines: { node: ">=22.12.0" } });
    ctx.add(
      "astro.config.mjs",
      `// @ts-check
import { defineConfig } from 'astro/config';
${tailwind ? "import tailwindcss from '@tailwindcss/vite';\n" : ""}
// https://astro.build/config
export default defineConfig({${tailwind ? "\n  vite: {\n    plugins: [tailwindcss()],\n  },\n" : ""}});
`
    );
    ctx.add("tsconfig.json", json({ extends: "astro/tsconfigs/strict", include: [".astro/types.d.ts", "**/*"], exclude: ["dist"] }));
    ctx.add(
      ".gitignore",
      "# build output\ndist/\n# generated types\n.astro/\n\n# dependencies\nnode_modules/\n\n# logs\nnpm-debug.log*\nyarn-debug.log*\nyarn-error.log*\npnpm-debug.log*\n\n# environment variables\n.env\n.env.production\n\n# macOS-specific files\n.DS_Store\n\n# jetbrains setting folder\n.idea/\n"
    );
    ctx.add(
      "public/favicon.svg",
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="24" fill="#bc52ee"/><path d="M44 96l20-64 20 64H72l-8-26-8 26z" fill="#fff"/></svg>\n`
    );
    ctx.add("src/styles/global.css", `${tailwind ? '@import "tailwindcss";\n\n' : ""}${STARTER_CSS}`);
    ctx.add(
      "src/pages/index.astro",
      `---
import '../styles/global.css';

const name = ${jsString(ctx.details.name)};
const description = ${jsString(describe(ctx, "An Astro site."))};
---

<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width" />
    <meta name="generator" content={Astro.generator} />
    <title>{name}</title>
  </head>
  <body>
    <main class="app">
      <h1>{name}</h1>
      <p>{description}</p>
      <p>Edit <code>src/pages/index.astro</code> and save to see it change.</p>${includedHtml(ctx)}
    </main>
  </body>
</html>
`
    );
    ctx.readme.setup.push("{run} dev");
    ctx.readme.notes.push("Open http://localhost:4321.", "- `{run} build` builds the site into `dist/`; `{run} preview` serves it.");
  },
};

