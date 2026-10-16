import { useLocation, useNavigate } from "react-router-dom";
import { DEPLOY_AVAILABLE, deployCloudPageUrl, deployHomeUrl, deployListUrl, deployProjectUrl } from "../deployLinks";
import { importFromDevice } from "../utils/importFromDevice";

/**
 * What Create/Import and Deploy do, shared by the header's menus (wide screens)
 * and the Create and Deploy panes (small screens, from the ☰ menu).
 */

// continuum-create (Backstage), if this setup has one: VITE_CREATE_URL. Unset: its item is hidden.
export const CREATE_URL = import.meta.env.VITE_CREATE_URL || "";

export { DEPLOY_AVAILABLE };

// Deploy menu: the clouds that deploy a selected project (Railway and GCP);
// every other cloud is on Continuum Deploy's start screen ("Show all").
export const DEPLOY_TARGETS = [
  { label: "Railway", cloud: "railway", deploysProject: true },
  { label: "Google Cloud (GCP)", cloud: "gcp", deploysProject: true },
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
      // No cloud ("Show all"): the start screen with every cloud. A cloud: the selected project's
      // deploy page, or (none selected) Railway's deployments / GCP's step-by-step page
      const url = !target
        ? deployHomeUrl()
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
