import { useLocation, useNavigate } from "react-router-dom";
import { DEPLOY_AVAILABLE, deployCloudPageUrl, deployConnectionsUrl, deployHomeUrl, deployListUrl, deployProjectUrl } from "../deployLinks";
import { importFromDevice } from "../utils/importFromDevice";

/**
 * What + Create and Deploy do, shared by the header's menus (wide screens)
 * and the Create and Deploy panes (small screens, from the ☰ menu).
 */

// continuum-create (Backstage), if this setup has one: VITE_CREATE_URL. Unset: its item is hidden.
export const CREATE_URL = import.meta.env.VITE_CREATE_URL || "";

export { DEPLOY_AVAILABLE };

// Deploy: AWS, Railway and GCP are live. deploysProject: deploying a selected
// project works there (Railway and GCP; AWS opens its connections). soon: not supported
// yet; opens that cloud's own page in Continuum Deploy, which says so.
export const DEPLOY_TARGETS = [
  { label: "AWS", cloud: "aws" },
  { label: "Railway", cloud: "railway", deploysProject: true },
  { label: "GCP", cloud: "gcp", deploysProject: true },
  { label: "Microsoft Azure", cloud: "azure", soon: true },
  { label: "Vercel", cloud: "vercel", soon: true },
  { label: "Netlify", cloud: "netlify", soon: true },
  { label: "Cloudflare", cloud: "cloudflare", soon: true },
  { label: "DigitalOcean", cloud: "digitalocean", soon: true },
  { label: "Heroku", cloud: "heroku", soon: true },
  { label: "Render", cloud: "render", soon: true },
  { label: "Oracle Cloud", cloud: "oracle", soon: true },
];

/** The actions; `done` runs first (e.g. close the menu it was chosen from). */
export function useShellActions(selectedProject, done = () => {}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Only a project imported from GitHub has a repository to deploy
  const deployable = selectedProject?.source === "github" ? selectedProject : null;

  return {
    deployable,

    /** Continuum Deploy, in a new tab so a running interval here is never interrupted */
    openDeployApp(target) {
      done();
      // Deploy itself opens the start screen. A cloud that deploys: the selected project's deploy page,
      // or (none selected) that cloud's deployments. Clouds that don't deploy yet open their connections.
      // GCP without a project: its own step-by-step page (account, infrastructure, projects)
      const url = !target
        ? deployHomeUrl()
        : target.soon
          ? deployCloudPageUrl(target.cloud)
          : !target.deploysProject
            ? deployConnectionsUrl(target.cloud)
            : deployable
              ? deployProjectUrl(deployable._id, target.cloud)
              : target.cloud === "gcp"
                ? deployCloudPageUrl("gcp")
                : deployListUrl(target.cloud);
      window.open(url, "_blank", "noopener");
    },

    newProject() {
      done();
      navigate("/new", { state: { from: pathname } });
    },

    externalCreate() {
      done();
      if (CREATE_URL) window.open(CREATE_URL, "_blank", "noopener");
    },

    /** Pick a folder; the console's Create Project window opens with its name */
    importFromDevice() {
      done();
      importFromDevice(() => pathname !== "/console" && navigate("/console"));
    },

    importFromGithub() {
      done();
      navigate("/import", { state: { from: pathname } });
    },
  };
}
