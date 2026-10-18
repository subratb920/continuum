/**
 * What Continuum does, for the public page (/) and the home page after
 * sign-in. Only what the apps really do today; training is marked as coming.
 * Each feature has a soft tone (its section's colour) and a picture
 * (components/FeatureArt.jsx). No admin or role configuration here: these
 * pages are seen by everyone.
 */
export const power = {
  title: "The power of continuum",
  lead: "One calm place to plan your work, hand it to AI, prepare your data and ship it, without losing the thread between sessions.",
  features: [
    {
      id: "intervals",
      tone: "sage",
      kicker: "Focus",
      title: "Purposeful work intervals",
      line: "30 or 45 minutes, one work mode, a ticket and a few small goals.",
      text: "Each session starts with a clear purpose and ends with an honest record: what was completed, what is incomplete and what was never touched.",
      points: ["Four work modes", "Small, concrete goals", "Stops with a useful handoff"],
    },
    {
      id: "spine",
      tone: "mist",
      kicker: "Continuity",
      title: "The Bridge Spine",
      line: "Every interval's goals and outcomes, kept in order.",
      text: "Come back after a day or a month and start from what really happened, not from memory. The spine links one session to the next.",
      points: ["Goals and outcomes per interval", "Ticket links and times", "Resume from reality"],
    },
    {
      id: "agents",
      tone: "lavender",
      kicker: "AI that asks",
      title: "A brain with workers",
      line: "Tell the brain what you need; it plans and hands the work to workers.",
      text: "Workers code in their own copy of your repository and ask before every change. Each commits on its own branch, never main, and pushes and deploys stay yours.",
      points: ["Chat with the brain", "Several workers at once", "Approve every change"],
    },
    {
      id: "data",
      tone: "sky",
      kicker: "Data",
      title: "Data ready to train on",
      line: "From raw files to a clean, versioned dataset.",
      text: "Bring data from uploads, Hugging Face, Kaggle, OpenML, UCI or any link. Profile it, clean it, split it into train, validation and test, and publish it with a quality score. Training a model is coming next.",
      points: ["Text, tables, images, audio", "Cleaning and quality score", "Train · validation · test"],
    },
    {
      id: "workspaces",
      tone: "sand",
      kicker: "Anywhere",
      title: "Workspaces in the browser",
      line: "VS Code with your repository and a terminal, one per project.",
      text: "Open a full development environment from a laptop or a phone. It sleeps by itself when you leave and your code stays until you delete it.",
      points: ["VS Code in the browser", "Small, standard or large", "Works on a phone"],
    },
    {
      id: "deploy",
      tone: "rose",
      kicker: "Ship",
      title: "Deploy to your own cloud",
      line: "Your apps live in your Google Cloud, set up for you.",
      text: "Continuum Deploy builds your apps from GitHub and puts them live in the order they need, with databases, backups and add-ons, in a cloud account that stays yours.",
      points: ["Kubernetes or Cloud Run", "Databases with backups", "Your account, your bill"],
    },
  ],
};
