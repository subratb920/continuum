import { LuFolderOpen, LuLayoutGrid, LuSparkles } from "react-icons/lu";
import { SiBackstage, SiGithub, SiGooglecloud, SiRailway } from "react-icons/si";
import { CREATE_URL, DEPLOY_TARGETS } from "./shellActions";
import { onPhone } from "../utils/device";
import "./menuItems.css";

/**
 * What Create/Import and Deploy list, shared by the header's menus (wide screens)
 * and the Create and Deploy panes (small screens, from the ☰ menu). Each item:
 * an icon, a title, a one-line hint; `divider` starts a new group.
 * Logos are shown only to identify each service (Simple Icons, CC0).
 */

const CLOUD_ICONS = {
  railway: <SiRailway className="menu-logo" />,
  gcp: <SiGooglecloud className="menu-logo menu-logo-gcloud" />,
};

/**
 * Create using Continuum → Import from device → Import from GitHub → Create via Backstage.
 * On a phone nothing is made on the device: Create on GitHub (Continuum's server) and Import from GitHub.
 */
export function createItems(actions, authProvider) {
  const phone = onPhone();
  return [
    {
      key: "continuum",
      feature: "create",
      icon: <LuSparkles className="menu-logo menu-logo-brand" />,
      title: phone ? "Create on GitHub" : "Create using Continuum",
      hint: phone ? "Made on Continuum's server, kept in your GitHub." : "A starter project: React, Node, Spring, Python and more.",
      onClick: actions.newProject,
    },
    // A phone can't hold a project: nothing is imported from it
    ...(phone
      ? []
      : [
          {
            key: "device",
            feature: "create",
            icon: <LuFolderOpen className="menu-logo" />,
            title: "Import from device",
            hint: "A project folder on this device.",
            onClick: actions.importFromDevice,
          },
        ]),
    {
      key: "github",
      feature: "import_github",
      icon: <SiGithub className="menu-logo" />,
      title: "Import from GitHub",
      // GitHub sign-ins only; greyed out (with the reason) for email sign-ins
      hint: authProvider === "github" ? "One of your repositories." : "Sign in with GitHub to import a repository.",
      onClick: actions.importFromGithub,
      disabled: authProvider !== "github",
    },
    ...(CREATE_URL
      ? [
          {
            key: "backstage",
            feature: "create",
            icon: <SiBackstage className="menu-logo" />,
            title: "Create via Backstage",
            hint: "Your organisation's templates.",
            onClick: actions.externalCreate,
            divider: true,
          },
        ]
      : []),
  ];
}

/** Railway, Google Cloud, then "Show all" (Continuum Deploy's start screen, every cloud) */
export function deployItems(actions) {
  const { deployable } = actions;
  return [
    ...DEPLOY_TARGETS.map((t) => ({
      key: t.cloud,
      feature: "deploy",
      icon: CLOUD_ICONS[t.cloud],
      title: `Deploy on ${t.label}`,
      hint: deployable ? `Deploys ${deployable.name}.` : t.cloud === "gcp" ? "Account, infrastructure and projects." : "Your Railway deployments.",
      onClick: () => actions.openDeployApp(t),
    })),
    {
      key: "all",
      feature: "deploy",
      icon: <LuLayoutGrid className="menu-logo" />,
      title: "Show all",
      hint: "Every cloud, in Continuum Deploy.",
      onClick: () => actions.openDeployApp(null),
      divider: true,
    },
  ];
}
