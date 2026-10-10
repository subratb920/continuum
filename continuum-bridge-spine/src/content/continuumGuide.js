/**
 * Continuum guide content
 * -----------------------
 * Single source for the text shown on the welcome screen, the empty
 * console and the Help page. Update capabilities here as features change.
 *
 * Capabilities list only what works in the current build ("Available").
 * Roadmap / future capabilities are intentionally not included yet.
 */

export const overview = {
  title: "Continuum",
  tagline: "Build continuously. Resume confidently. Keep development moving.",
  summary:
    "Continuum is a development model and workspace designed to help individual developers and small teams make consistent progress on software projects without losing context between work sessions.",
  sections: [
    {
      heading: "Why Continuum exists",
      paragraphs: [
        "Software development rarely happens in one uninterrupted stretch. Work gets paused, priorities change, unfinished tasks accumulate, and returning to a project can mean reconstructing what happened, why decisions were made, and what to do next.",
        "Continuum addresses this by organizing development into short, purposeful work intervals and preserving a structured record of progress through the Bridge Spine.",
      ],
    },
    {
      heading: "Development that remembers where it left off",
      paragraphs: [
        "Every work interval has a purpose. You define what you intend to accomplish, work toward those goals, and record what was completed and what remains unfinished.",
        "The Bridge Spine preserves this record across intervals, helping you understand the history of your work and establish a clearer starting point for the next session.",
      ],
    },
  ],
  principle:
    "Progress is not just what you complete. It is also the context you preserve for continuing.",
  goal:
    "Help development remain understandable, resumable, and consistent, even when work is interrupted or projects become complex.",
};

export const gettingStarted = {
  title: "Getting started",
  steps: [
    {
      title: "Create or select a project",
      text: "Choose the software project whose development you want to continue. Use + in the Projects panel to create one, then Activate Project to make it your active project.",
    },
    {
      title: "Define the interval",
      text: "In Interval Setup, select a work mode, choose a duration, link the story or ticket, and write a small set of concrete goals.",
    },
    {
      title: "Work toward the goals",
      text: "Focus on the selected work rather than continually expanding the scope.",
    },
    {
      title: "Capture the outcome",
      text: "Mark each goal completed, incomplete, or untouched, and preserve the interval's record as a Bridge.",
    },
    {
      title: "Review and continue",
      text: "Use the Bridge Spine to inspect previous work and decide the next goals.",
    },
  ],
  goalTip: {
    heading: "Keep goals small",
    text: "A goal should describe a small, achievable outcome, not an entire feature.",
    examples: [
      { label: "Too broad", text: "Build authentication." },
      { label: "Better", text: "Implement email validation in the registration form." },
      {
        label: "Better still",
        text: "Implement email validation and verify it with valid and invalid inputs.",
      },
    ],
  },
};

export const model = {
  title: "The Continuum development model",
  principles: [
    {
      title: "Work in purposeful intervals",
      text: "Instead of treating development as an unbounded activity, define a manageable interval with a clear objective and explicit goals.",
    },
    {
      title: "Make progress observable",
      text: "Record what the interval was intended to achieve and what actually happened. Unfinished work and newly discovered constraints are also important information.",
    },
    {
      title: "Preserve continuity",
      text: "The Bridge Spine connects intervals through a persistent record of goals and outcomes, reducing the effort needed to reconstruct project state after a break.",
    },
    {
      title: "Stop with a useful handoff",
      text: "An interval should leave you with an accurate record of the current state, unresolved work, and the next safe step, rather than letting work expand indefinitely.",
    },
    {
      title: "Continue from reality, not memory alone",
      text: "The next interval should begin from the actual state of the project and the evidence captured previously, not simply from a recollection of what was planned.",
    },
    {
      title: "Apply the same discipline to AI",
      text: "When agents participate in development, the same continuity principles extend to requirements, plans, implementation attempts, test evidence, and recovery after interruption.",
    },
  ],
};

export const capabilities = {
  title: "What you can do today",
  items: [
    {
      title: "Project workspace",
      status: "Available",
      text: "Create, rename, and delete projects, and choose one active project to work on. Continuum keeps one active project at a time.",
    },
    {
      title: "Session goals",
      status: "Available",
      text: "Define specific goals for an interval and classify each one as completed, incomplete, or untouched when recording the outcome.",
    },
    {
      title: "Purposeful work intervals",
      status: "Available",
      text: "Start an interval on your active project with a work mode, a 30- or 45-minute duration, and a link to the story or ticket you are working on.",
    },
    {
      title: "Bridge Spine and work history",
      status: "Available",
      text: "Review previous intervals for a project, including their goals, recorded statuses, ticket links, and start and close times.",
    },
    {
      title: "Email sign-in",
      status: "Available",
      text: "Create an account and sign in with your email and password. Your projects and Bridges are saved to your account.",
    },
  ],
};

export const modes = {
  title: "The four modes",
  intro:
    "Every interval is labelled with one mode, so the purpose of the session is clear before you start.",
  note: "Modes currently label the purpose of an interval; they don't change how the app behaves.",
  items: [
    {
      name: "Decision",
      purpose: "Resolve a technical or product decision before implementation.",
    },
    {
      name: "Execution",
      purpose: "Implement a clearly defined piece of work.",
    },
    {
      name: "Continuity",
      purpose: "Resume interrupted work, reconstruct context, and establish the next step.",
    },
    {
      name: "Alignment",
      purpose: "Reconcile requirements, architecture, priorities, and current implementation.",
    },
  ],
};

export const glossary = {
  title: "Glossary",
  terms: [
    {
      term: "Project",
      definition: "A long-lived piece of software work. Each project has its own Bridge Spine.",
    },
    {
      term: "Active project",
      definition: "The one project you are currently working on. Intervals can only be started on the active project.",
    },
    {
      term: "Interval",
      definition: "A short, focused work session (30 or 45 minutes) with a mode and a set of session goals.",
    },
    {
      term: "Session goal",
      definition: "A small, achievable outcome you intend to reach within one interval.",
    },
    {
      term: "Bridge",
      definition: "The record of an interval: its goals and whether each was completed, incomplete, or untouched.",
    },
    {
      term: "Bridge Spine",
      definition: "The timeline of all Bridges for a project, so you can see the history of your work and continue from it.",
    },
    {
      term: "Mode",
      definition: "The purpose of an interval: Decision, Execution, Continuity, or Alignment.",
    },
  ],
};

/**
 * Roadmap — FUTURE direction, kept separate from current capabilities.
 * Nothing here is available yet. No delivery dates are implied.
 */
export const roadmap = {
  title: "Roadmap",
  label: "Future direction — not available yet",
  intro:
    "Where Continuum is heading. These capabilities are planned and are not part of the current product. No delivery dates are implied.",
  directions: [
    {
      heading: "Self-directed development",
      text: "You remain in control of the work. Use Continuum to organize projects, define session goals, maintain a record of progress, and return to development with greater clarity.",
    },
    {
      heading: "Agentic development",
      text: "Continuum is intended to extend the same continuity model to AI-assisted and agent-driven development: interpreting requirements, organizing work into dependent goals, coordinating suitable agents and models, verifying results, and preserving execution state so work can continue safely across intervals. The objective is not simply to make AI generate code, but to provide a disciplined process for carrying development from requirements toward verified outcomes.",
    },
  ],
  horizons: [
    {
      name: "Horizon 1 — Reliable continuity",
      tag: "Foundation",
      summary: "Make the core development model dependable before expanding its scope.",
      items: [
        "Resume an unfinished interval after reload or interruption.",
        "Record the next safe step and relevant decisions.",
        "Carry incomplete goals forward deliberately.",
        "Enforce interval duration and hard-stop behaviour.",
        "Add automated API and frontend tests.",
        "Improve authentication, authorization, and error reporting.",
        "Make the four interval modes behaviourally meaningful.",
      ],
    },
    {
      name: "Horizon 2 — Planning intelligence",
      tag: "Planned direction",
      summary: "Move from manually entered session goals to structured development planning.",
      items: [
        "Import and analyse detailed requirements.",
        "Break requirements into modules and small goals.",
        "Model dependencies between goals.",
        "Define acceptance criteria and test plans before implementation.",
        "Propose a workflow for the developer to review and approve.",
        "Use the current project state and Bridge Spine when recommending next work.",
      ],
    },
    {
      name: "Horizon 3 — Agentic development orchestration",
      tag: "Longer-term vision",
      summary: "Coordinate agents and models within a controlled, resumable development process.",
      items: [
        "Register and select suitable agents and models.",
        "Route goals to appropriate capabilities, including planning, design, engineering, and testing.",
        "Execute approved goals in isolated working environments.",
        "Run planned tests and collect implementation evidence.",
        "Independently verify acceptance criteria.",
        "Retry failed work or advance only after verification.",
        "Enforce interval boundaries and save resumable execution state.",
        "Preserve agent assignments, attempts, outcomes, and evidence in the development record.",
      ],
    },
  ],
};
