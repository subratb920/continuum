// src/create/catalog/common.js
//
// Pieces several kinds share: option lists, detail fields, ignore files.

import { field } from "../fields.js";

export const LANGUAGE_OPTION = {
  id: "language",
  label: "Language",
  type: "choice",
  values: [
    { id: "ts", label: "TypeScript", icon: "SiTypescript" },
    { id: "js", label: "JavaScript", icon: "SiJavascript" },
  ],
  default: "ts",
};

export const PACKAGE_MANAGER_OPTION = {
  id: "packageManager",
  label: "Package manager",
  type: "choice",
  values: [
    { id: "npm", label: "npm", icon: "SiNpm" },
    { id: "pnpm", label: "pnpm", icon: "SiPnpm" },
    { id: "yarn", label: "Yarn", icon: "SiYarn" },
    { id: "bun", label: "Bun", icon: "SiBun" },
  ],
  default: "npm",
};

/** name + description, for npm-based projects */
export const NPM_DETAILS = [
  field("name", "Project name", "npmName", { placeholder: "my-app", default: "my-app", help: "Also the folder's and package's name" }),
  field("description", "Description", "text", { required: false, placeholder: "What it does" }),
];

export const NODE_GITIGNORE = `# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

node_modules
dist
dist-ssr
build
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
.DS_Store
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?
`;

/** A package entry for a dependency */
export const npm = (name, range, dev = false) => ({ registry: "npm", name, range, dev });

/** A JavaScript string literal in single quotes (the starters' style), safe for any text */
export const jsString = (value) => `'${JSON.stringify(String(value)).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'")}'`;
