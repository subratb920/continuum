/**
 * Continuum's copyright and intellectual property notice: the footer on every
 * screen and the Legal page (/legal). Plain, calm wording: who owns what and
 * what needs permission; the user's own work stays theirs.
 */

export const COPYRIGHT_HOLDER = "Continuum";

/** "© 2026 Continuum" (the current year) */
export function copyrightLine() {
  return `© ${new Date().getFullYear()} ${COPYRIGHT_HOLDER}`;
}

/** The footer's sentence after "© <year> Continuum. All rights reserved." */
export const FOOTER_NOTE = "Continuum is for personal use or use within your organization; redistributing, rebranding or reselling it isn't permitted.";

export const LEGAL_INTRO = "Continuum and Continuum Deploy are made and owned by Continuum. This page explains who owns what, and what needs permission.";

export const LEGAL_SECTIONS = [
  {
    title: "Copyright",
    text: "The software, its design, text, graphics, logos and documentation are owned by Continuum and protected by copyright law. All rights reserved.",
  },
  {
    title: "Intellectual property",
    text: "All intellectual property rights in Continuum, including copyright, trademarks, designs and know-how, belong to Continuum. Using the service gives you the right to use it as described below; it doesn't transfer ownership or grant any other licence.",
  },
  {
    title: "How you may use it",
    text: "You're welcome to use Continuum for your own personal use, or within your organization for its own work.",
  },
  {
    title: "What isn't permitted",
    text: "Continuum may not be sold, resold, rented, sublicensed, redistributed, rebranded or offered under another name (including as a white-label product). Its software and content may not be copied, published, reverse engineered or used to build products derived from it. Any of these needs Continuum's written agreement.",
  },
  {
    title: "Names and logos",
    text: "“Continuum”, “Continuum Deploy” and their logos identify Continuum's products. Please ask before using them.",
  },
  {
    title: "Your work stays yours",
    text: "Projects, code, repositories and anything else you bring to Continuum or make with it belong to you. Continuum claims no ownership of them and uses them only to provide the service to you. To run and secure the service, Continuum records sign-ins (when, how, IP address and approximate location from it, network details such as connection type and speed, browser and device) and which parts of it you use, and keeps these records for up to 180 days.",
  },
  {
    title: "Open-source software",
    text: "Continuum includes open-source components, each under its own licence. Those licences continue to apply to those components and are not changed by this notice.",
  },
];
