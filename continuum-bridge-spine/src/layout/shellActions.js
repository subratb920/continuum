import { useLocation, useNavigate } from "react-router-dom";
import { DEPLOY_AVAILABLE, deployCloudPageUrl, deployHomeUrl, deployListUrl, deployProjectUrl } from "../deployLinks";
import { importFromDevice } from "../utils/importFromDevice";
import { useAuth } from "../state/authStore";

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

/**
 * The actions; `done` runs first (e.g. close the menu it was chosen from).
 * One your role has switched off opens "No feature access" instead.
 */
export function useShellActions(selectedProject, done = () => {}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { can } = useAuth();
  /** The action, or "No feature access" when its feature is switched off. */
  const gated = (feature, act) => (...args) => {
    if (can(feature)) return act(...args);
    done();
    navigate("/no-access", { state: { feature, from: pathname } });
  };
  // Only a project imported from GitHub has a repository to deploy
  const deployable = selectedProject?.source === "github" ? selectedProject : null;

  return {
    deployable,

    /** Continuum Deploy, in a new tab so a running interval here is never interrupted */
    openDeployApp: gated("deploy", (target) => {
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
    }),

    newProject: gated("create", () => {
      done();
      navigate("/new", { state: { from: pathname } });
    }),

    externalCreate: gated("create", () => {
      done();
      if (CREATE_URL) window.open(CREATE_URL, "_blank", "noopener");
    }),

    /** Pick a folder; the console's Create Project window opens with its name */
    importFromDevice: gated("create", () => {
      done();
      importFromDevice(() => pathname !== "/console" && navigate("/console"));
    }),

    importFromGithub: gated("import_github", () => {
      done();
      navigate("/import", { state: { from: pathname } });
    }),
  };
}
