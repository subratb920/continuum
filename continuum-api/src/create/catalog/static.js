// src/create/catalog/static.js
//
// A plain website: HTML, CSS and JavaScript, no build step.

import { field } from "../fields.js";
import { staticTemplate } from "../templates/angular-svelte-static.js";

export default {
  id: "static",
  name: "HTML, CSS & JS",
  icon: "SiHtml5",
  description: "A plain website with no build step.",
  groups: [],
  variants: [
    {
      id: "site",
      name: "Static site",
      icon: "SiHtml5",
      description: "index.html, styles.css and script.js, ready to open or host anywhere.",
      options: [],
      details: [
        field("name", "Project name", "slug", { placeholder: "my-site", default: "my-site", help: "Also the folder's name" }),
        field("description", "Description", "text", { required: false, placeholder: "What it is" }),
      ],
      template: staticTemplate,
    },
  ],
  dependencies: [],
};
