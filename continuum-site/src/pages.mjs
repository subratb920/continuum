/**
 * The public site's pages: what search engines read and what people find.
 * What Continuum is and what it is built to become. Each page is one topic
 * people search for, with its own
 * title (under ~60 characters), description (under ~160), one h1, sections,
 * and questions (shown, and given to search engines as an FAQ).
 */

export const SITE = {
  name: "Continuum",
  fullName: "Continuum Console",
  tagline: "The AI agent orchestration IDE",
  email: "continuum.console@gmail.com",
};

export const PAGES = [
  {
    path: "/",
    nav: "Home",
    title: "Continuum: AI Agent Orchestration Platform & AI IDE",
    description:
      "AI-driven platform: orchestrate AI agents and AI workflows, build enterprise systems and products, modernize mainframes, automate ML pipelines and deploy.",
    kicker: "AI-driven development",
    statement:
      "One AI-driven place for the whole journey: plan large systems from a concept, let AI agents build them through AI workflows, modernize legacy code, turn your data into your own models, and deploy to your cloud. Together, with your team.",
    h1: "The AI agent orchestration platform: from concept to code, models and cloud",
    lead: "Plan large systems from a concept, hand the work to a team of AI agents through AI workflows, modernize mainframes, automate data science and machine learning pipelines, create your own AI models, and deploy to your cloud autonomously. One AI-driven place, and it remembers where you left off.",
    sections: [
      {
        h2: "AI agents that work as a team",
        text: "A brain agent plans your goal and hands the parts to worker agents. Each worker codes in its own copy of your repository, on its own branch, and asks before every change. You approve, send work back, or step in at any time.",
        points: ["Multi-agent orchestration", "Human in the loop: approve every change", "Never pushes to main on its own"],
        link: "/ai-agent-orchestration",
      },
      {
        h2: "AI workflows you can see",
        text: "Draw the work as a workflow: tasks, reviews, approvals and loops. When tests fail, the work goes back along a loop arrow with what failed, until it passes. Watch every step live on the canvas.",
        points: ["Visual workflow canvas", "Fail-first loops until tests pass", "Approvals and send-backs"],
        link: "/ai-workflows",
      },
      {
        h2: "Mainframe migration with AI agents",
        text: "Ready-made workflows for COBOL to Java, PL/I batch replatforming, mainframe data to PostgreSQL and CICS transactions to APIs: inventory, translation, equivalence tests, load tests and a parallel run, each checked before the next.",
        points: ["COBOL to Java", "DB2 and VSAM data to PostgreSQL", "CICS to REST APIs"],
        link: "/mainframe-migration",
      },
      {
        h2: "Data ready for machine learning",
        text: "Bring data from uploads, Hugging Face, Kaggle, OpenML, UCI or any link. Profile it, clean it, split it into train, validation and test sets, and publish a versioned dataset with a quality score.",
        points: ["Text, tables, images, audio", "Data cleaning and profiling", "Train, validation and test splits"],
        link: "/data-science",
      },
      {
        h2: "Your choice of AI models",
        text: "Run your agents on Claude, OpenAI, OpenCode Zen, any OpenAI-compatible server, or a local model through Ollama on your own computer.",
        points: ["Cloud or local LLMs", "One switch for every agent", "Bring your own model server"],
        link: "/ai-models",
      },
      {
        h2: "Enterprise systems from a concept",
        text: "Turn an idea into an architecture and a plan, then let AI agents build large, complex enterprise systems part by part, with reviews, tests and approvals at every gate.",
        points: ["Conceptual planning", "System design", "Parallel AI delivery"],
        link: "/enterprise-ai",
      },
      {
        h2: "Organizations and teams",
        text: "Create your own organization, invite your team, organize departments and roles, and share projects, workspaces and AI agents.",
        points: ["Your own organization", "Work in teams", "Shared workspaces"],
        link: "/teams",
      },
      {
        h2: "Build your own products with AI",
        text: "Describe the app or SaaS product you want; AI agents plan, code, test and launch it through AI workflows.",
        points: ["AI app builder", "Vibe coding that ships", "Idea to launch"],
        link: "/build-with-ai",
      },
      {
        h2: "Automated data science and ML pipelines",
        text: "Ingestion, cleaning, feature engineering, AutoML training, evaluation, deployment and monitoring, run end to end as one pipeline.",
        points: ["AutoML", "MLOps", "Drift monitoring"],
        link: "/ml-pipelines",
      },
      {
        h2: "Create your own AI models",
        text: "Train machine learning, deep learning and NLP models on your data, fine-tune open-source LLMs and add RAG, then serve them privately.",
        points: ["Custom models", "LLM fine-tuning", "Private AI"],
        link: "/custom-ai-models",
      },
      {
        h2: "Autonomous AI-driven cloud deployment",
        text: "AI studies your repository, plans the architecture and deploys it to Kubernetes, Cloud Run or any cloud, with databases, backups and your domain.",
        points: ["AI DevOps", "Kubernetes and Cloud Run", "Your account, your bill"],
        link: "/ai-cloud-deployment",
      },
    ],
    faq: [
      {
        q: "What is Continuum?",
        a: "Continuum is an AI integrated development environment (AI IDE) where a team of AI agents plans and writes code under your direction, with visual AI workflows, data preparation for machine learning, browser workspaces and deployment to your own cloud.",
      },
      {
        q: "What is AI agent orchestration?",
        a: "AI agent orchestration is coordinating several AI agents on one goal: one agent plans and splits the work, others do the parts at the same time, and their results are reviewed and merged. In Continuum a brain agent orchestrates worker agents, and you approve their changes.",
      },
      {
        q: "Can Continuum help with mainframe modernization?",
        a: "Yes. Continuum has ready-made AI workflows for COBOL to Java, PL/I batch replatforming, mainframe data to PostgreSQL and CICS to APIs. AI agents do each step, tests and load tests check it, and failing work loops back until it passes.",
      },
      {
        q: "Can I build my own AI models with Continuum?",
        a: "Continuum is built for the whole path to your own AI model: finding and preparing the data, automated data science pipelines, training and fine-tuning machine learning, deep learning and NLP models, and deploying them.",
      },
      {
        q: "What is Continuum going to be?",
        a: "One AI-driven platform from idea to production: conceptual planning of large enterprise systems, AI agents that build them through AI workflows, automated data science and ML pipelines, your own AI models, and autonomous deployment to your cloud.",
      },
    ],
  },
  {
    path: "/ai-agent-orchestration",
    nav: "Agent orchestration",
    title: "AI Agent Orchestration: Multi-Agent Development | Continuum",
    description:
      "Orchestrate AI coding agents: a brain agent plans and splits the work, worker agents code in parallel on their own branches, and you approve every change.",
    kicker: "Agentic AI",
    h1: "AI agent orchestration: a brain, its workers, and you",
    lead: "Agentic AI for real software work. Tell Continuum's brain what you need; it plans, splits the work and hands it to worker agents that code at the same time, each in its own copy of your repository.",
    sections: [
      {
        h2: "How the agents work",
        text: "The brain agent reads your goal and your project, plans the parts and starts a worker for each. Workers read code, edit files, run tests and report back. The brain reviews each result and sends work back when it isn't good enough yet.",
        points: ["Planning and task splitting", "Parallel AI coding agents", "Review before anything is done"],
      },
      {
        h2: "Human in the loop, always",
        text: "Workers ask before every change, and you see each question as it comes. Every worker commits on its own branch, never main. Pushing and deploying stay yours.",
        points: ["Approve or refuse each change", "Answer an agent's questions", "Your branches, your merges"],
      },
      {
        h2: "Watch them on the Agent Stage",
        text: "The Agent Stage shows the brain and every worker live: what each is doing, which tool it is calling, and who is waiting on you. Samples show a fix with retries, split work, plan-first, and a mainframe load test.",
        points: ["Live view of every agent", "Tool calls as they happen", "Waiting-on-you at a glance"],
      },
      {
        h2: "Agent-driven development, with focus",
        text: "Work in purposeful intervals of 30 or 45 minutes with a few small goals. Each interval ends with an honest record of what was done, what wasn't, and what's next, so the agents and you pick up from what really happened.",
        points: ["Goals per interval", "Outcomes recorded", "Resume from reality, not memory"],
      },
    ],
    faq: [
      {
        q: "What is a multi-agent system for coding?",
        a: "A multi-agent coding system uses several AI agents together: one plans and coordinates, others write and test code in parallel. Continuum's brain agent coordinates worker agents and reviews their work before it is done.",
      },
      {
        q: "Can the AI agents change my main branch?",
        a: "No. Each worker commits on its own branch and asks before each change. Merging, pushing and deploying are always yours.",
      },
      {
        q: "Which AI models do the agents run on?",
        a: "Claude, OpenAI, OpenCode Zen, any OpenAI-compatible server, or a local model through Ollama. You choose one model for every agent.",
      },
    ],
  },
  {
    path: "/ai-workflows",
    nav: "AI workflows",
    title: "AI Workflows: AI Agent Workflow Automation | Continuum",
    description:
      "Design AI workflows on a canvas: tasks, reviews, approvals and fail-first loops. AI agents run each step and failing work loops back until tests pass.",
    kicker: "Workflow automation",
    h1: "AI workflows: draw the work, let AI agents run it",
    lead: "A workflow is your plan as a picture: the steps, which need which, where people approve, and where work goes back when it fails. Continuum's AI agents run it step by step, and you watch it live.",
    sections: [
      {
        h2: "Steps, arrows and loops",
        text: "Task steps carry instructions, the files they may touch and a check. Arrows say which step needs another's result; steps without one run at the same time. Loop arrows send work back: from failing tests to the fix, from a review to the work, from an approval to the plan.",
        points: ["Parallel steps where possible", "Loop arrows with a try limit", "Checks on every task"],
      },
      {
        h2: "Fail first, then pass",
        text: "Real work rarely passes the first time. When a test or check fails, the step is marked failed with what failed, and the work loops back with that failure in its task, so the next try fixes it.",
        points: ["Test-driven AI development", "Failures carried into the next try", "Stops and asks you after the limit"],
      },
      {
        h2: "Approvals and send-backs",
        text: "Approval steps are yours. Approve to go on, or send the work back with a note, and it returns along its loop arrow to be redone with your note.",
        points: ["Human approval gates", "Send back with a note", "Final review before merge"],
      },
      {
        h2: "Ready-made AI workflow templates",
        text: "Start from a sample: feature with tests, bug fix, docs and release notes, refactor in parts, or a mainframe migration. Edit it on the canvas and run it.",
        points: ["Everyday software workflows", "Mainframe migration workflows", "Your own, saved as templates"],
      },
    ],
    faq: [
      {
        q: "What is an AI workflow?",
        a: "An AI workflow is a set of steps carried out by AI agents in order, with checks, reviews and human approvals between them. In Continuum you draw it on a canvas and the agents run it.",
      },
      {
        q: "What happens when an AI agent's work fails a test?",
        a: "The step is marked failed with what failed, and the work goes back along its loop arrow to be fixed, with the failure in the task. After the try limit, Continuum stops and asks you.",
      },
    ],
  },
  {
    path: "/mainframe-migration",
    nav: "Mainframe migration",
    title: "AI Mainframe Migration: COBOL to Java & CICS | Continuum",
    description:
      "Modernize mainframes with AI agents: COBOL to Java, PL/I batch replatforming, DB2 and VSAM data to PostgreSQL, CICS to REST APIs, tested at every step.",
    kicker: "Legacy modernization",
    h1: "Mainframe migration with AI agents, tested at every step",
    lead: "Move COBOL, PL/I, CICS and mainframe data to modern platforms with AI-driven workflows: inventory, translation, equivalence testing, load testing and a parallel run, with failing steps looping back until they pass.",
    sections: [
      {
        h2: "COBOL to Java",
        text: "Inventory programs and copybooks, translate them in waves, and prove each wave behaves the same with equivalence tests on real inputs before load testing it on the new platform.",
        points: ["Program and copybook inventory", "Wave-by-wave translation", "Equivalence tests per wave"],
      },
      {
        h2: "PL/I batch replatforming",
        text: "Replatform batch jobs and their JCL schedules, then check batch windows and outputs against the mainframe's before the switch.",
        points: ["JCL and batch job mapping", "Batch window checks", "Output comparison"],
      },
      {
        h2: "Mainframe data to PostgreSQL",
        text: "Map DB2 tables and VSAM files to PostgreSQL schemas, convert EBCDIC and packed decimals, load the data and reconcile counts and totals.",
        points: ["DB2 and VSAM to PostgreSQL", "EBCDIC and COMP-3 conversion", "Reconciliation of counts and totals"],
      },
      {
        h2: "CICS transactions to APIs",
        text: "Turn CICS transactions and BMS screens into REST APIs and services, with contract tests that check each one answers as the transaction did.",
        points: ["CICS to REST APIs", "Contract tests", "Gradual cut-over"],
      },
      {
        h2: "Load tests that loop until they pass",
        text: "Set the target, such as requests per second and latency. When the load test misses it, the workflow loops back to tuning with the bottleneck it found, and tests again.",
        points: ["Throughput and latency targets", "Bottleneck found, fixed, retested", "Parallel run before cut-over"],
      },
    ],
    faq: [
      {
        q: "Can AI convert COBOL to Java?",
        a: "AI agents can translate COBOL to Java, but translation alone isn't enough. Continuum's mainframe workflow pairs each translated wave with equivalence tests and load tests, and sends failing work back to be fixed.",
      },
      {
        q: "How do you prove a migrated system behaves the same?",
        a: "With equivalence tests that run the same inputs through the mainframe and the new system and compare outputs, reconciliation of data counts and totals, and a parallel run before cut-over.",
      },
      {
        q: "Which mainframe technologies does the workflow cover?",
        a: "COBOL, PL/I, JCL batch, CICS transactions and BMS screens, DB2 tables and VSAM files, moving to Java, REST APIs and PostgreSQL.",
      },
    ],
  },
  {
    path: "/ai-ide",
    nav: "AI IDE",
    title: "AI IDE: AI Integrated Development Environment | Continuum",
    description:
      "An AI integrated development environment: AI coding agents, AI pair programming, VS Code in the browser, GitHub import, and focused work intervals.",
    kicker: "AI-powered IDE",
    h1: "An AI integrated development environment built around agents",
    lead: "Continuum is an AI IDE where coding agents do the work you plan, and you keep control. Import from GitHub or start a new project, open VS Code in the browser, and let agents write and test code with you.",
    sections: [
      {
        h2: "AI coding agents and pair programming",
        text: "Chat with the brain about your project, or let it plan and start workers. Each worker reads, edits and tests code in its own copy of the repository and asks before changing anything.",
        points: ["AI pair programming", "Code generation with review", "Tests run by the agents"],
      },
      {
        h2: "Workspaces in the browser",
        text: "Open VS Code with your repository and a terminal, one workspace per project, from a laptop or a phone. It sleeps when you leave, and your code stays until you delete it.",
        points: ["VS Code in the browser", "Cloud development environment", "Works on a phone"],
      },
      {
        h2: "Projects from GitHub or from scratch",
        text: "Import repositories from GitHub or your device, or create a new project from a template, then put it on GitHub when you're ready.",
        points: ["GitHub import", "Project templates", "Publish to GitHub"],
      },
      {
        h2: "The Bridge Spine: continuity between sessions",
        text: "Every interval's goals and outcomes, kept in order with ticket links and times. Come back after a day or a month and start from what really happened.",
        points: ["Goals and outcomes", "Ticket links", "Resume where you left off"],
      },
    ],
    faq: [
      {
        q: "What is an AI IDE?",
        a: "An AI IDE is a development environment where AI helps write, test and review code. Continuum goes further: a team of AI agents plans and does the work, and you approve each change.",
      },
      {
        q: "Do I need to install anything?",
        a: "No. Continuum runs in the browser, including VS Code workspaces with a terminal. You can also run AI models locally through Ollama.",
      },
    ],
  },
  {
    path: "/ai-skills",
    nav: "AI skills",
    title: "AI Agent Skills: Reusable Know-How for AI Agents | Continuum",
    description:
      "AI agent skills give Continuum's agents reusable know-how: planning scopes, running workflows, reviewing work, running checks and settling merge clashes.",
    kicker: "Agent skills",
    h1: "AI agent skills: what Continuum's agents know how to do",
    lead: "Skills are reusable instructions an agent loads when a task calls for them. They make agents consistent: the same careful steps every time, instead of improvising.",
    sections: [
      {
        h2: "Skills of the brain",
        text: "The brain agent plans scopes so workers don't clash, drafts and runs workflows step by step, reviews each worker's work before it counts as done, and settles merge clashes between workers.",
        points: ["Plan scopes", "Run workflows", "Review work", "Settle clashes"],
      },
      {
        h2: "Skills of the workers",
        text: "Workers run the project's checks before saying they're done and finish with a report of what they changed, what they tested and what's left.",
        points: ["Run checks", "Final report"],
      },
      {
        h2: "Why skills matter",
        text: "Large language models do better with clear, specific instructions. Skills package the instructions for recurring work so every agent follows the same proven steps.",
        points: ["Consistent results", "Fewer mistakes", "Know-how that grows"],
      },
    ],
    faq: [
      {
        q: "What are AI agent skills?",
        a: "AI agent skills are packaged instructions and steps an AI agent loads when a task needs them, such as reviewing work or running a workflow, so it does recurring work the same careful way every time.",
      },
    ],
  },
  {
    path: "/data-science",
    nav: "Data science & ML",
    title: "Data Science & ML: Datasets for Machine Learning | Continuum",
    description:
      "Prepare data for machine learning, deep learning and NLP: import from Hugging Face, Kaggle, OpenML or UCI, profile, clean, split and version datasets.",
    kicker: "Data curation",
    h1: "Data science and machine learning start with good data",
    lead: "Continuum's data tools take you from raw files to a clean, versioned dataset ready to train a model on, for machine learning, deep learning, natural language processing and computer vision. Made so that anyone can do it.",
    sections: [
      {
        h2: "Find and bring in data",
        text: "Import from uploads, Hugging Face, Kaggle, OpenML, the UCI Machine Learning Repository, or any link.",
        points: ["Hugging Face datasets", "Kaggle and OpenML", "UCI and any URL"],
      },
      {
        h2: "Profile and clean",
        text: "See what's in the data: types, gaps, duplicates, outliers. Clean it into one tidy table, and get a quality score that says how ready it is.",
        points: ["Data profiling", "Data cleaning", "Quality score"],
      },
      {
        h2: "Ready for training",
        text: "Split into train, validation and test sets and publish a versioned dataset, for tabular machine learning, deep learning on images and audio, or NLP on text.",
        points: ["Train, validation and test splits", "Versioned datasets", "Text, tables, images, audio"],
      },
      {
        h2: "Pipelines that run safely",
        text: "Each step of a data pipeline runs in its own locked-down container with only your folder, and only download steps can reach the network.",
        points: ["Reproducible data pipelines", "Isolated steps", "Your data stays yours"],
      },
      {
        h2: "From dataset to model",
        text: "Clean, versioned datasets flow straight into machine learning and deep learning model development: train, evaluate, compare and ship models built on your own data.",
        points: ["ML model development", "Deep learning", "NLP models"],
        link: "/machine-learning",
      },
    ],
    faq: [
      {
        q: "How do I prepare a dataset for machine learning?",
        a: "Collect the data, profile it, clean it (fix types, gaps, duplicates and outliers), split it into train, validation and test sets, and version it. Continuum does each of these steps for you.",
      },
      {
        q: "What is a data science platform?",
        a: "A data science platform brings data collection, preparation, analysis, model development and deployment into one place. Continuum adds AI agents and AI workflows that run those steps for you.",
      },
    ],
  },
  {
    path: "/ai-models",
    nav: "AI models",
    title: "AI Models & LLMs: Claude, OpenAI, Local Ollama | Continuum",
    description:
      "Run Continuum's AI agents on the large language model you choose: Claude, OpenAI, OpenCode Zen, any OpenAI-compatible server, or local models with Ollama.",
    kicker: "Large language models",
    h1: "Your choice of AI models for every agent",
    lead: "Continuum's agents run on the large language model (LLM) you pick: in the cloud, on your own model server, or locally on your computer.",
    sections: [
      {
        h2: "Cloud LLMs",
        text: "Claude, OpenAI and OpenCode Zen models, for the strongest reasoning and coding.",
        points: ["Claude", "OpenAI", "OpenCode Zen"],
      },
      {
        h2: "Local and open models",
        text: "Run open-source models on your own computer through Ollama, or point Continuum at any OpenAI-compatible server, for privacy and control over cost.",
        points: ["Ollama on your computer", "OpenAI-compatible servers", "Open-source LLMs"],
      },
      {
        h2: "One switch for every agent",
        text: "Choose the model once; the brain and every worker run on it. Only models that can use tools are offered, because agents need tools to work.",
        points: ["Tool-using models only", "One model, every agent", "Change it any time"],
      },
    ],
    faq: [
      {
        q: "Can I run Continuum's AI agents on a local model?",
        a: "Yes. Choose a model from Ollama running on your computer, or any OpenAI-compatible server. A local model answers one request at a time, so workers take turns.",
      },
    ],
  },
  {
    path: "/ai-cloud-deployment",
    nav: "AI cloud deployment",
    title: "Autonomous AI-Driven Cloud Deployment & DevOps | Continuum",
    description:
      "Autonomous AI-driven cloud deployment: AI studies your code, plans the architecture and deploys to Kubernetes, Cloud Run or any cloud, with backups.",
    kicker: "AI DevOps",
    h1: "Autonomous AI-driven cloud deployment, from repository to production",
    lead: "Continuum's AI reads your repository, works out how each app runs, plans the deployment and puts it live in your own cloud, in the right order, with databases, backups, certificates and your domain. DevOps, done by AI, watched by you.",
    sections: [
      {
        h2: "AI that studies your code first",
        text: "Before anything is deployed, AI studies the repository: the stack, how each app starts, the databases it needs, its settings and secrets. It writes the app's architecture and a deployment plan, with blockers and warnings, before a single resource is created.",
        points: ["Automatic architecture discovery", "Deployment plan by stages", "Pre-flight checks"],
      },
      {
        h2: "Kubernetes, Cloud Run and multi-cloud",
        text: "Deploy to Google Kubernetes Engine, Cloud Run, Railway, AWS and more. Autoscaling, HTTPS certificates, load balancing and custom domains are set up for you.",
        points: ["Kubernetes (GKE) and Cloud Run", "Multi-cloud deployment", "Autoscaling and HTTPS"],
      },
      {
        h2: "Autonomous operations (AIOps)",
        text: "AI agents watch deployments, find what broke, propose the fix and roll it out after your approval. Every version is kept, so any deploy can be rolled back or redeployed.",
        points: ["Self-healing deployments", "Rollback to any version", "Cost visibility"],
      },
      {
        h2: "Infrastructure as code, without writing it",
        text: "Databases with backups, networks, secrets and certificates are created from the plan, in a cloud account that stays yours.",
        points: ["PostgreSQL and MongoDB", "Secrets management", "Your account, your bill"],
      },
    ],
    faq: [
      {
        q: "Can AI deploy my application to the cloud?",
        a: "Yes. Continuum's AI studies your repository, plans the deployment and deploys your apps to your own cloud on Kubernetes or Cloud Run, with databases, certificates and your domain.",
      },
      {
        q: "What is AIOps?",
        a: "AIOps is using AI for IT operations: watching systems, finding the cause of problems and fixing them. Continuum brings AI agents to deployment and operations, with you approving the changes.",
      },
      {
        q: "How do I deploy a full-stack app to Kubernetes?",
        a: "Connect your GitHub repository and your cloud account to Continuum. It works out each app, its database and settings, plans the order, and deploys everything to Kubernetes for you.",
      },
    ],
  },
  {
    path: "/enterprise-ai",
    nav: "Enterprise systems",
    title: "Enterprise AI Development: Concept to System | Continuum",
    description:
      "Plan and build large, complex enterprise systems with AI: from a concept to architecture, system design, microservices and AI agents delivering every part.",
    kicker: "Enterprise AI",
    h1: "From a concept to a complex enterprise system, planned and built with AI",
    lead: "Describe the system you want. Continuum turns the concept into a plan: the architecture, the services, the data, the order of work. Then AI agents build it part by part through AI workflows, with reviews, tests and your approvals at every gate.",
    sections: [
      {
        h2: "Conceptual planning",
        text: "Start from an idea, a document or an existing system. AI turns it into goals, a system design and a plan of work you can read, change and approve.",
        points: ["Concept to plan", "Requirements to user stories", "Plans you approve"],
      },
      {
        h2: "Architecture and system design",
        text: "Services, APIs, data models and integration points designed for scale: microservices or modular monoliths, event-driven or request-driven, chosen for the problem.",
        points: ["Enterprise architecture", "Microservices and APIs", "Data modelling"],
      },
      {
        h2: "Large systems, built in parts",
        text: "Big work is split into scopes that don't clash, run by many AI agents at the same time, reviewed, tested and merged. Workflows keep the order and the gates.",
        points: ["Parallel AI agents", "Scopes without clashes", "Reviews and test gates"],
      },
      {
        h2: "Governance built in",
        text: "Roles, organizations and departments decide who sees and changes what. Every sign-in and admin change is recorded. Work happens on branches and nothing ships without approval.",
        points: ["Organizations and roles", "Audit trail", "Human approval gates"],
      },
      {
        h2: "Legacy modernization",
        text: "Bring existing systems along: mainframe migration, monolith to microservices, and on-premises to cloud, with equivalence tests proving nothing changed.",
        points: ["Monolith to microservices", "Mainframe to cloud", "Digital transformation"],
        link: "/mainframe-migration",
      },
    ],
    faq: [
      {
        q: "Can AI build enterprise software?",
        a: "AI agents can build enterprise software when the work is planned, split into clear parts, reviewed and tested. Continuum plans the system, runs AI agents through workflows with test and approval gates, and keeps people in charge.",
      },
      {
        q: "How do you plan a large software system with AI?",
        a: "Start from the concept, let AI draft the architecture and the plan of work, review and adjust it, then let AI agents build it in parts through workflows with tests and approvals between them.",
      },
    ],
  },
  {
    path: "/build-with-ai",
    nav: "Build products with AI",
    title: "AI App Builder: Build Your Own Product with AI | Continuum",
    description:
      "Build your own apps and products with AI: describe the idea, AI agents plan, code, test and deploy it through AI workflows. From idea to launch, faster.",
    kicker: "AI app builder",
    h1: "Build your own products with AI workflows",
    lead: "Have an idea for an app, a SaaS product or an internal tool? Describe it. Continuum's AI agents plan it, write the code, test it and deploy it, through workflows you can see and steer. Vibe coding, with engineering discipline.",
    sections: [
      {
        h2: "Idea to working app",
        text: "Start from a sentence or a template. AI drafts the plan, sets up the project and builds the features one workflow at a time: front end, back end, database and tests.",
        points: ["Full-stack apps", "Web and mobile", "SaaS and internal tools"],
      },
      {
        h2: "Vibe coding that ships",
        text: "Talk to the AI about what you want and watch it build. Every change is reviewed and tested, so fast doesn't mean fragile.",
        points: ["Natural-language programming", "Reviewed AI code", "Tests on every change"],
      },
      {
        h2: "No-code, low-code or full code",
        text: "Let the AI do everything, guide it step by step, or open VS Code in the browser and write code alongside it.",
        points: ["No-code AI builder", "Low-code workflows", "Full code access"],
      },
      {
        h2: "Launch it",
        text: "Put it on GitHub and deploy it to your own cloud with a domain and HTTPS, from the same place.",
        points: ["GitHub publishing", "One-click cloud deploy", "Your own domain"],
        link: "/ai-cloud-deployment",
      },
    ],
    faq: [
      {
        q: "How do I build an app with AI?",
        a: "Describe what you want, let AI agents plan and build it in steps, review and test each step, then deploy. Continuum does all of this in one place, from idea to a live app in your cloud.",
      },
      {
        q: "What is vibe coding?",
        a: "Vibe coding is building software by describing what you want to an AI and steering it in conversation instead of writing every line yourself. Continuum adds plans, reviews and tests so the result is production-ready.",
      },
      {
        q: "Can I build a SaaS product with AI?",
        a: "Yes. Continuum's AI agents can plan, code, test and deploy a full-stack SaaS product, with you approving each step.",
      },
    ],
  },
  {
    path: "/agent-driven-development",
    nav: "Agent-driven development",
    title: "Agent-Driven Development: AI Software Engineers | Continuum",
    description:
      "AI agent-driven development: autonomous AI software engineers that plan, write, test and review code, with AI code review, AI testing and human approval.",
    kicker: "AI software engineering",
    h1: "AI agent-driven development: autonomous AI software engineers on your team",
    lead: "Agent-driven development puts AI agents at the centre of the software lifecycle: they plan, write code, write and run tests, review each other's work and fix what fails, while you set the goals and approve the results.",
    sections: [
      {
        h2: "Autonomous coding agents",
        text: "AI software engineers take a ticket, read the codebase, make the change, run the tests and report back, each in its own copy of the repository and on its own branch.",
        points: ["Autonomous AI coding", "Ticket to pull request", "Own branch per agent"],
      },
      {
        h2: "AI testing and test generation",
        text: "Agents write unit, integration and end-to-end tests, run them, and loop until they pass. Fail-first loops turn failing tests into the next task.",
        points: ["AI test generation", "Test-driven development", "Regression checks"],
      },
      {
        h2: "AI code review",
        text: "A reviewing agent checks each change before it counts as done and sends it back with what's missing. You see every review.",
        points: ["Automated code review", "Send-back with reasons", "Quality gates"],
      },
      {
        h2: "Refactoring and bug fixing at scale",
        text: "Refactor in parts, fix bugs with a failing test first, upgrade dependencies and pay down technical debt across a large codebase, many agents at once.",
        points: ["AI refactoring", "AI bug fixing", "Technical debt"],
      },
    ],
    faq: [
      {
        q: "What is an AI software engineer?",
        a: "An AI software engineer is an AI agent that can take a task, read the code, make changes, run tests and report back. Continuum runs a team of them, coordinated by a brain agent, with you approving changes.",
      },
      {
        q: "Will AI agents replace developers?",
        a: "AI agents take on the repetitive and parallel parts of software work. Developers set direction, make decisions, review and approve. Continuum is built around that partnership.",
      },
    ],
  },
  {
    path: "/ml-pipelines",
    nav: "Automated ML pipelines",
    title: "Automated ML Pipelines: AutoML & MLOps | Continuum",
    description:
      "Automate the entire data science pipeline: data ingestion, cleaning, feature engineering, AutoML training, evaluation, deployment and monitoring with MLOps.",
    kicker: "MLOps",
    h1: "Entire data science pipelines, automated end to end",
    lead: "From raw data to a model in production without stitching tools together: ingestion, cleaning, feature engineering, training, evaluation, deployment and monitoring, run as one automated pipeline by AI agents.",
    sections: [
      {
        h2: "Data ingestion and ETL",
        text: "Pull data from files, databases, APIs, Hugging Face, Kaggle, OpenML and UCI. Extract, transform and load it into clean, versioned datasets.",
        points: ["ETL and ELT", "Data connectors", "Versioned datasets"],
        link: "/data-science",
      },
      {
        h2: "Feature engineering",
        text: "Profile the data, handle missing values and outliers, encode, scale and create features, with each step recorded so the pipeline is reproducible.",
        points: ["Feature engineering", "Data validation", "Reproducible steps"],
      },
      {
        h2: "AutoML and training",
        text: "Try many models and hyperparameters automatically, compare them on validation data and keep the best, for classification, regression, forecasting, NLP and vision.",
        points: ["AutoML", "Hyperparameter tuning", "Experiment tracking"],
      },
      {
        h2: "Deployment and monitoring",
        text: "Serve the chosen model as an API, watch accuracy and data drift, and retrain when it slips. MLOps without the plumbing.",
        points: ["Model serving", "Drift monitoring", "Automatic retraining"],
      },
    ],
    faq: [
      {
        q: "What is an automated machine learning pipeline?",
        a: "An automated ML pipeline runs every step from raw data to a deployed model without manual hand-offs: ingestion, cleaning, feature engineering, training, evaluation, deployment and monitoring.",
      },
      {
        q: "What is MLOps?",
        a: "MLOps is the practice of building, deploying and running machine learning models reliably: versioned data and models, repeatable pipelines, automated deployment and monitoring in production.",
      },
      {
        q: "What is AutoML?",
        a: "AutoML automatically tries different models and settings on your data and picks the best one, so you get a good model without hand-tuning every option.",
      },
    ],
  },
  {
    path: "/machine-learning",
    nav: "ML & deep learning",
    title: "Machine Learning, Deep Learning & NLP | Continuum",
    description:
      "Develop machine learning and deep learning models: NLP, computer vision, predictive analytics and forecasting, from dataset to deployed model.",
    kicker: "ML models",
    h1: "Machine learning, deep learning and NLP model development",
    lead: "Build ML models on your own data: classic machine learning for predictions, deep learning for images, audio and text, and natural language processing for language. Data, training, evaluation and deployment in one AI-driven place.",
    sections: [
      {
        h2: "Machine learning models",
        text: "Classification, regression, clustering and forecasting with gradient boosting, random forests, linear models and more, for predictive analytics on your business data.",
        points: ["Predictive analytics", "Time series forecasting", "Classification and regression"],
      },
      {
        h2: "Deep learning",
        text: "Neural networks for images, audio, video and text, with PyTorch and TensorFlow, on GPUs in your cloud.",
        points: ["Neural networks", "PyTorch and TensorFlow", "GPU training"],
      },
      {
        h2: "Natural language processing",
        text: "Text classification, sentiment analysis, named entity recognition, summarization, search and question answering with transformer models.",
        points: ["NLP models", "Transformers", "Sentiment and entities"],
      },
      {
        h2: "Computer vision",
        text: "Image classification, object detection and segmentation, from labelled datasets to deployed models.",
        points: ["Image classification", "Object detection", "Segmentation"],
      },
    ],
    faq: [
      {
        q: "What is the difference between machine learning and deep learning?",
        a: "Machine learning learns patterns from data with algorithms such as decision trees and linear models. Deep learning is a kind of machine learning that uses many-layered neural networks, and works best for images, audio and language.",
      },
      {
        q: "How do I develop a machine learning model?",
        a: "Define the problem, collect and clean the data, split it into train, validation and test sets, train and compare models, evaluate the best one on the test set, then deploy and monitor it.",
      },
    ],
  },
  {
    path: "/custom-ai-models",
    nav: "Create your own AI models",
    title: "Create Your Own AI Model: Train & Fine-Tune LLMs | Continuum",
    description:
      "Create your own AI models: train custom models on your data, fine-tune LLMs, build RAG with vector search, evaluate and deploy them as private AI.",
    kicker: "Custom AI",
    h1: "Create your own AI models, trained on your data",
    lead: "Own your AI. Train custom models on your data, fine-tune open-source large language models, ground them with retrieval-augmented generation, and deploy them privately in your cloud.",
    sections: [
      {
        h2: "Train custom models",
        text: "Start from a clean dataset and train a model built for your problem, then evaluate it against a test set you trust.",
        points: ["Custom model training", "Evaluation and benchmarks", "Your data stays yours"],
      },
      {
        h2: "Fine-tune LLMs",
        text: "Fine-tune open-source large language models such as Llama, Mistral, Qwen and Gemma on your own examples, with LoRA and QLoRA to keep it affordable.",
        points: ["LLM fine-tuning", "LoRA and QLoRA", "Open-source LLMs"],
      },
      {
        h2: "RAG and vector search",
        text: "Connect a model to your documents with retrieval-augmented generation: embeddings, a vector database and grounded answers with sources.",
        points: ["Retrieval-augmented generation", "Embeddings", "Vector databases"],
      },
      {
        h2: "Private AI in your cloud",
        text: "Serve your models as APIs in your own cloud or on your own machines, and use them from Continuum's agents and your apps.",
        points: ["Private LLM hosting", "Model APIs", "On-premises or cloud"],
        link: "/ai-models",
      },
    ],
    faq: [
      {
        q: "How do I create my own AI model?",
        a: "Collect and prepare data for your task, choose a base model or architecture, train or fine-tune it on your data, evaluate it, then deploy it as an API. Continuum brings these steps together.",
      },
      {
        q: "What is fine-tuning an LLM?",
        a: "Fine-tuning trains an existing large language model a little further on your own examples, so it learns your style, terms or task, without training a model from scratch.",
      },
      {
        q: "What is RAG?",
        a: "Retrieval-augmented generation (RAG) gives a language model relevant passages from your documents when it answers, so its answers are grounded in your data and can cite sources.",
      },
    ],
  },
  {
    path: "/teams",
    nav: "Teams & organizations",
    title: "Teams & Organizations: Shared AI Workspaces | Continuum",
    description:
      "Create your own organization, invite your team, organize departments and roles, and share projects, workspaces and AI agents. AI collaboration for teams.",
    kicker: "Teamwork",
    h1: "Create your organization and build with AI as a team",
    lead: "Bring your team into Continuum: create an organization, invite people, group them into departments, and share projects, workspaces, workflows and AI agents. Everyone works in the same space; each sees what they should.",
    sections: [
      {
        h2: "Your own organization",
        text: "Create an organization in a minute, name it, and switch between it and your personal space at any time. Work in several organizations with one account.",
        points: ["Create organizations", "Personal and team spaces", "One account, many orgs"],
      },
      {
        h2: "Invite your team",
        text: "Invite people by email, give them a role in the organization and the departments they belong to. They join with one click.",
        points: ["Email invites", "Organization roles", "Owners, admins and members"],
      },
      {
        h2: "Departments and access",
        text: "Group people into departments and choose which departments see each project, so engineering, data science and operations each work in their own lane.",
        points: ["Departments", "Project access by department", "Role-based access control"],
      },
      {
        h2: "Shared workspaces and projects",
        text: "Share projects and browser workspaces with your team, pick up each other's work from the Bridge Spine, and run AI workflows and agents together.",
        points: ["Shared workspaces", "Team projects", "Shared AI workflows"],
      },
      {
        h2: "Built for companies",
        text: "A directory of users, roles and sign-ins, an audit trail of every admin change, and single sign-on across Continuum's apps.",
        points: ["User directory", "Audit logs", "Single sign-on"],
        link: "/enterprise-ai",
      },
    ],
    faq: [
      {
        q: "Can my team work together in Continuum?",
        a: "Yes. Create an organization, invite your team by email, put them in departments, and share projects, workspaces, workflows and AI agents.",
      },
      {
        q: "How do I share my workspace with my team?",
        a: "Create or join an organization in Continuum and work in its space: its projects and workspaces are shared with the members and departments you choose.",
      },
      {
        q: "Who can see an organization's projects?",
        a: "The organization's owners and admins see everything; members see the projects shared with their departments.",
      },
    ],
  },
  {
    path: "/generative-ai",
    nav: "Generative AI",
    title: "Generative AI Development Platform for LLM Apps | Continuum",
    description:
      "Build generative AI applications: LLM apps, AI chatbots, AI assistants and agents, RAG, prompt engineering and Model Context Protocol tools, on any model.",
    kicker: "GenAI",
    h1: "A generative AI development platform for LLM applications",
    lead: "Build generative AI into your products: chatbots and assistants, AI agents with tools, document question answering, content generation and code generation, on Claude, OpenAI or open-source models.",
    sections: [
      {
        h2: "LLM applications",
        text: "Chatbots, AI assistants, copilots and AI agents that use tools, built and tested by Continuum's own agents and deployed to your cloud.",
        points: ["AI chatbots", "AI assistants and copilots", "Tool-using agents"],
      },
      {
        h2: "Prompt engineering and evaluation",
        text: "Design prompts and agent skills, test them against examples and compare models, so quality is measured, not guessed.",
        points: ["Prompt engineering", "LLM evaluation", "Model comparison"],
        link: "/ai-skills",
      },
      {
        h2: "Model Context Protocol and integrations",
        text: "Give AI agents tools and data through the Model Context Protocol (MCP) and APIs: repositories, databases, documents and services.",
        points: ["MCP servers", "API integrations", "Agent tools"],
      },
      {
        h2: "Any model",
        text: "Claude, OpenAI, open-source and local models through one interface, so you can switch as models improve.",
        points: ["Model-agnostic", "Cloud and local LLMs", "LLMOps"],
        link: "/ai-models",
      },
    ],
    faq: [
      {
        q: "What is generative AI?",
        a: "Generative AI is AI that creates new content, such as text, code, images or audio, from a prompt. Large language models like Claude and GPT are generative AI for text and code.",
      },
      {
        q: "What is the Model Context Protocol (MCP)?",
        a: "The Model Context Protocol is an open standard for connecting AI models and agents to tools and data sources, so an agent can read files, query databases or call services in a uniform way.",
      },
      {
        q: "What is agentic AI?",
        a: "Agentic AI is AI that pursues a goal by planning, taking actions with tools and checking results, rather than only answering one prompt. Continuum's AI agents are agentic AI for software, data and deployment.",
      },
    ],
  },
];
