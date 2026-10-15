// src/create/catalog/svelte.js
//
// Svelte: SvelteKit (as `sv create` makes it) and Svelte with Vite
// (create-vite's svelte-ts).

import { PACKAGE_MANAGER_OPTION, NPM_DETAILS, npm } from "./common.js";
import { svelteKitTemplate, svelteViteTemplate } from "../templates/angular-svelte-static.js";
import { commonWebDependencies } from "./web-common.js";

const GROUPS = [
  { id: "ui", name: "UI and styling" },
  { id: "data", name: "Data fetching" },
  { id: "forms", name: "Forms and validation" },
  { id: "testing", name: "Testing" },
  { id: "tooling", name: "Tooling" },
];

export default {
  id: "svelte",
  name: "Svelte",
  icon: "SiSvelte",
  description: "Compiled, fast web apps with very little code.",
  groups: GROUPS,
  variants: [
    {
      id: "sveltekit",
      name: "SvelteKit",
      icon: "SiSvelte",
      description: "The Svelte framework: routing, server rendering and adapters for any host.",
      options: [PACKAGE_MANAGER_OPTION],
      details: NPM_DETAILS,
      template: svelteKitTemplate,
    },
    {
      id: "vite",
      name: "Vite",
      icon: "SiVite",
      description: "A Svelte single-page app with Vite.",
      options: [PACKAGE_MANAGER_OPTION],
      details: NPM_DETAILS,
      template: svelteViteTemplate,
    },
  ],
  dependencies: [
    {
      id: "tailwind",
      name: "Tailwind CSS",
      description: "Utility-first CSS, wired into Vite.",
      group: "ui",
      icon: "SiTailwindcss",
      docs: "https://tailwindcss.com/docs",
      packages: [npm("tailwindcss", "^4.0.0", true), npm("@tailwindcss/vite", "^4.0.0", true)],
      apply(ctx) {
        ctx.slot("tailwind", true);
        if (ctx.variant.id === "vite") ctx.slot("vitePlugins", { import: "import tailwindcss from '@tailwindcss/vite'", call: "tailwindcss()" });
      },
    },
    ...commonWebDependencies({ variants: ["sveltekit", "vite"] }),
  ],
};
