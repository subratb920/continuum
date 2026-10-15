// src/create/catalog/angular.js
//
// Angular: a standalone app as `ng new` makes it (Vitest for unit tests,
// Prettier included).

import { PACKAGE_MANAGER_OPTION, NPM_DETAILS, npm } from "./common.js";
import { angularTemplate } from "../templates/angular-svelte-static.js";
import { commonWebDependencies } from "./web-common.js";

const GROUPS = [
  { id: "ui", name: "UI and styling" },
  { id: "data", name: "Data fetching" },
  { id: "forms", name: "Forms and validation" },
  { id: "testing", name: "Testing" },
  { id: "tooling", name: "Tooling" },
];

export default {
  id: "angular",
  name: "Angular",
  icon: "SiAngular",
  description: "Google's platform for large web apps, with everything built in.",
  groups: GROUPS,
  variants: [
    {
      id: "standalone",
      name: "Angular app",
      icon: "SiAngular",
      description: "A standalone, zoneless Angular app with routing and Vitest, as `ng new` creates it.",
      options: [PACKAGE_MANAGER_OPTION],
      details: NPM_DETAILS,
      template: angularTemplate,
    },
  ],
  dependencies: [
    {
      id: "material",
      name: "Angular Material",
      description: "Material Design components and the CDK, with a ready theme.",
      group: "ui",
      icon: "SiAngular",
      docs: "https://material.angular.dev/",
      packages: [npm("@angular/material", "^22.2.0"), npm("@angular/cdk", "^22.2.0")],
      apply: (ctx) => ctx.slot("angularStyles", "@angular/material/prebuilt-themes/azure-blue.css"),
    },
    {
      id: "tailwind",
      name: "Tailwind CSS",
      description: "Utility-first CSS through PostCSS, as Angular's guide sets it up.",
      group: "ui",
      icon: "SiTailwindcss",
      docs: "https://tailwindcss.com/docs/installation/framework-guides/angular",
      packages: [npm("tailwindcss", "^4.0.0", true), npm("@tailwindcss/postcss", "^4.0.0", true), npm("postcss", "^8.5.0", true)],
      apply(ctx) {
        ctx.slot("tailwind", true);
        ctx.add(".postcssrc.json", `${JSON.stringify({ plugins: { "@tailwindcss/postcss": {} } }, null, 2)}\n`);
      },
    },
    ...commonWebDependencies({ variants: ["standalone"], axios: false }).filter((d) => d.id !== "prettier"),
  ],
};
