/**
 * The menu bar: the topics in groups, shown on the bar (each group opens a
 * panel), and a short line and an icon per topic, used by the menu and by
 * the workflow-run section. Icons are 24×24 line drawings (stroke paths).
 */

export const MENU = [
  {
    label: "Platform",
    lead: "The AI agent orchestration IDE: agents, workflows, skills and models in one place.",
    items: ["/ai-agent-orchestration", "/ai-workflows", "/agent-driven-development", "/ai-ide", "/ai-skills", "/ai-models"],
    feature: "/ai-workflows",
  },
  {
    label: "Solutions",
    lead: "What you build with Continuum, from a concept to production.",
    items: ["/enterprise-ai", "/build-with-ai", "/mainframe-migration", "/ai-cloud-deployment", "/generative-ai"],
    feature: "/mainframe-migration",
  },
  {
    label: "Data & AI",
    lead: "From raw data to your own models, with every step automated.",
    items: ["/data-science", "/ml-pipelines", "/machine-learning", "/custom-ai-models"],
    feature: "/custom-ai-models",
  },
];

/** Straight to a page from the bar (no panel). */
export const MENU_LINKS = ["/teams"];

/** A few words per topic. */
export const BLURB = {
  "/ai-agent-orchestration": "A brain and its workers on one goal",
  "/ai-workflows": "Draw the work; agents run it",
  "/agent-driven-development": "AI software engineers on your team",
  "/ai-ide": "Code with agents, in the browser",
  "/ai-skills": "Reusable know-how for every agent",
  "/ai-models": "Claude, OpenAI or local LLMs",
  "/enterprise-ai": "From a concept to a complex system",
  "/build-with-ai": "Your idea, built and launched",
  "/mainframe-migration": "COBOL, PL/I and CICS, modernized",
  "/ai-cloud-deployment": "AI that deploys to your cloud",
  "/generative-ai": "LLM apps, chatbots and agents",
  "/data-science": "Datasets ready for machine learning",
  "/ml-pipelines": "Raw data to production, automated",
  "/machine-learning": "ML, deep learning, NLP and vision",
  "/custom-ai-models": "Train and fine-tune on your data",
  "/teams": "Organizations, roles, shared workspaces",
};

export const ICON = {
  "/ai-agent-orchestration": "M12 4a2 2 0 1 0 0 .01M5 18a2 2 0 1 0 0 .01M19 18a2 2 0 1 0 0 .01M12 6v4m0 0-6 6m6-6 6 6",
  "/ai-workflows": "M4 5h5v4H4zM15 15h5v4h-5zM6.5 9v3a3 3 0 0 0 3 3H15M15 5h5v4h-5zM9 7h6",
  "/agent-driven-development": "M8 9l-4 3 4 3M16 9l4 3-4 3M13.5 6l-3 12",
  "/ai-ide": "M3 5h18v12H3zM8 21h8M12 17v4M7 9l2 2-2 2M11 13h4",
  "/ai-skills": "M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z",
  "/ai-models": "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5",
  "/enterprise-ai": "M4 21V7l6-4v18M10 21V9h10v12M4 21h17M13 12h1M17 12h1M13 16h1M17 16h1M7 9v.01M7 13v.01M7 17v.01",
  "/build-with-ai": "M5 15c-1 1-1.5 4-1.5 4.5 0 0 3.5-.5 4.5-1.5M12 15l-3-3M14.5 3.5c3 0 6 3 6 6 0 3-4 8-8.5 9.5l-3-3C10.5 11.5 11.5 3.5 14.5 3.5zM15 9a1 1 0 1 0 0 .01",
  "/mainframe-migration": "M4 4h7v16H4zM7 8h1M7 12h1M7 16h1M14 12h6M17 9l3 3-3 3",
  "/ai-cloud-deployment": "M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9zM12 17v-6M9.5 13.5 12 11l2.5 2.5",
  "/generative-ai": "M4 5h16v11H9l-5 4zM9 10h.01M12 10h.01M15 10h.01",
  "/data-science": "M12 4c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  "/ml-pipelines": "M3 12h4l2-5 3 10 2-5h7M18 9l3 3-3 3",
  "/machine-learning": "M5 6a2 2 0 1 0 0 .01M5 18a2 2 0 1 0 0 .01M12 12a2 2 0 1 0 0 .01M19 6a2 2 0 1 0 0 .01M19 18a2 2 0 1 0 0 .01M7 6.5l3.5 4.5M7 17.5l3.5-4.5M14 11l3.3-4M14 13l3.3 4",
  "/custom-ai-models": "M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12 4 7.5",
  "/teams": "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5.3a3 3 0 0 1 0 5.4M18 14.3c1.8.8 3 2.6 3 4.7",
};

/** An icon as inline SVG (stroked, in the current colour). */
export const icon = (path, size = 20) =>
  `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICON[path] ?? ""}"/></svg>`;

/** Continuum's mark (bridge-spine's BrandMark): the infinity loop, blue into orange, with the bridge and its star. */
export const LOGO = (h = 26, id = "lg") => `<svg class="logo" width="${Math.round((h * 48) / 30)}" height="${h}" viewBox="0 0 48 30" aria-hidden="true">
<defs><linearGradient id="${id}-loop" x1="2" y1="0" x2="46" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1d4ed8"/><stop offset=".32" stop-color="#38bdf8"/><stop offset=".55" stop-color="#fbbf24"/><stop offset="1" stop-color="#ea580c"/></linearGradient><linearGradient id="${id}-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#f59e0b"/></linearGradient><radialGradient id="${id}-glow"><stop offset="0" stop-color="#fde68a" stop-opacity=".9"/><stop offset="1" stop-color="#fde68a" stop-opacity="0"/></radialGradient></defs>
<path class="logo-loop" d="M24 19C19 13 14.5 10.5 10 10.5 5.6 10.5 2.8 14 2.8 19s2.8 8.4 7.2 8.4c4.5 0 9-2.4 14-8.4 5-6 9.5-8.5 14-8.5 4.4 0 7.2 3.5 7.2 8.5s-2.8 8.4-7.2 8.4c-4.5 0-9-2.4-14-8.4z" fill="none" stroke="url(#${id}-loop)" stroke-width="3.4" stroke-linejoin="round"/>
<path d="M15.5 9Q24 3.6 32.5 9" fill="none" stroke="url(#${id}-gold)" stroke-width="1.3" stroke-linecap="round"/>
<circle cx="24" cy="2.6" r="2.6" fill="url(#${id}-glow)"/>
<path class="logo-star" d="M24 .4l.5 1.7 1.7.5-1.7.5-.5 1.7-.5-1.7-1.7-.5 1.7-.5z" fill="#fde68a"/>
</svg>`;
