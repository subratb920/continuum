// src/create/catalog/vue.js
//
// Vue projects: Vite (as create-vue sets it up) and Nuxt.

import { LANGUAGE_OPTION, PACKAGE_MANAGER_OPTION, NPM_DETAILS, npm } from "./common.js";
import { nuxtTemplate, vueViteTemplate } from "../templates/vue.js";
import { commonWebDependencies } from "./web-common.js";

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
    id: "vue-router",
    name: "Vue Router",
    description: "Pages and links, with a Home and an About page.",
    group: "routing",
    icon: "SiVuedotjs",
    docs: "https://router.vuejs.org/",
    appliesTo: ["vite"],
    packages: [npm("vue-router", "^5.0.0")],
    apply: (ctx) => ctx.slot("router", true),
  },
  {
    id: "pinia",
    name: "Pinia",
    description: "The official Vue store, with a counter store to start from.",
    group: "state",
    docs: "https://pinia.vuejs.org/",
    packages: [npm("pinia", "^4.0.0")],
    apply(ctx) {
      ctx.slot("pinia", true);
      if (ctx.variant.id === "nuxt") {
        ctx.pkg("npm", "@pinia/nuxt", "^1.0.0");
        ctx.slot("nuxtModules", "@pinia/nuxt");
      }
    },
  },
  {
    id: "vueuse",
    name: "VueUse",
    description: "200+ composition utilities (mouse, storage, fetch…).",
    group: "state",
    docs: "https://vueuse.org/",
    packages: [npm("@vueuse/core", "^15.0.0")],
    apply(ctx) {
      if (ctx.variant.id === "nuxt") {
        ctx.pkg("npm", "@vueuse/nuxt", "^15.0.0");
        ctx.slot("nuxtModules", "@vueuse/nuxt");
      }
    },
  },
  {
    id: "tailwind",
    name: "Tailwind CSS",
    description: "Utility-first CSS, wired into the build.",
    group: "ui",
    icon: "SiTailwindcss",
    docs: "https://tailwindcss.com/docs",
    packages: [npm("tailwindcss", "^4.0.0", true), npm("@tailwindcss/vite", "^4.0.0", true)],
    apply(ctx) {
      ctx.slot("tailwind", true);
      if (ctx.variant.id === "vite") ctx.slot("vitePlugins", { import: "import tailwindcss from '@tailwindcss/vite'", call: "tailwindcss()" });
    },
  },
  {
    id: "vitest",
    name: "Vitest + Vue Test Utils",
    description: "Component tests, with a first test for App.",
    group: "testing",
    icon: "SiVitest",
    docs: "https://test-utils.vuejs.org/",
    appliesTo: ["vite"],
    packages: [npm("vitest", "^5.0.0", true), npm("@vue/test-utils", "^2.4.0", true), npm("jsdom", "^30.0.0", true)],
    apply: (ctx) => ctx.slot("vitest", true),
  },
  ...commonWebDependencies({ variants: ["vite", "nuxt"] }),
];

export default {
  id: "vue",
  name: "Vue",
  icon: "SiVuedotjs",
  description: "Approachable, fast web interfaces with Vue.",
  groups: GROUPS,
  variants: [
    {
      id: "vite",
      name: "Vite",
      icon: "SiVite",
      description: "A Vue single-page app with Vite, set up as create-vue does.",
      options: [LANGUAGE_OPTION, PACKAGE_MANAGER_OPTION],
      details: NPM_DETAILS,
      template: vueViteTemplate,
    },
    {
      id: "nuxt",
      name: "Nuxt",
      icon: "SiNuxt",
      description: "The full-stack Vue framework: server rendering, file-based routes, auto-imports.",
      options: [PACKAGE_MANAGER_OPTION],
      details: NPM_DETAILS,
      template: nuxtTemplate,
    },
  ],
  dependencies: DEPENDENCIES,
};

