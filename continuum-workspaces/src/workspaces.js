import { randomBytes } from "node:crypto";
import { request } from "node:http";

/** What each size gets while it runs. */
export const SIZES = {
  small: { cpus: 1, memoryGb: 2 },
  standard: { cpus: 2, memoryGb: 4 },
  large: { cpus: 4, memoryGb: 8 },
};

const ID = /^[a-f0-9]{24}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const LABEL = "continuum.workspace";

export class WorkspaceError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Checks what start() is given; returns the size's limits. */
export function checkStart({ id, repo, githubToken, size }) {
  if (!ID.test(String(id))) throw new WorkspaceError(400, "Not a workspace id.");
  if (!REPO.test(String(repo))) throw new WorkspaceError(400, "repo must be owner/name.");
  const s = SIZES[size];
  if (!s) throw new WorkspaceError(400, "size must be small, standard or large.");
  if (typeof githubToken !== "string" || !githubToken) throw new WorkspaceError(400, "A GitHub sign-in is needed to open the repository.");
  return s;
}

export const isWorkspaceId = (id) => ID.test(String(id));

/** The container and the volume of a workspace (the volume keeps the code and settings). */
export const containerName = (id) => `continuum-ws-${id}`;
export const volumeName = (id) => `continuum-ws-${id}-home`;

/**
 * Workspaces on Docker (local development): one container per running
 * workspace, running the workspace image (OpenVSCode Server), on Continuum's
 * Docker network, with its own volume for /home/workspace. Stopping removes
 * the container and keeps the volume; deleting removes both.
 */
export function dockerWorkspaces({ docker, image, network, basePath = "/w", probe = probeEditor, readyTimeoutMs = 45_000 }) {
  // Access tokens of running workspaces, only in this service's memory (lost on a restart: then Open restarts it)
  const tokens = new Map();
  const pathOf = (id, token) => `${basePath}/${id}/?tkn=${encodeURIComponent(token)}`;

  function check(id) {
    if (!ID.test(String(id))) throw new WorkspaceError(400, "Not a workspace id.");
  }

  async function status(id) {
    check(id);
    const c = await docker.inspectContainer(containerName(id));
    if (!c) return { id, state: "stopped" };
    if (c.State?.Running) return { id, state: c.State.Health?.Status === "starting" ? "starting" : "running", startedAt: c.State.StartedAt, size: c.Config?.Labels?.["continuum.size"] ?? null };
    return { id, state: "stopped" };
  }

  /**
   * Starts (or restarts) a workspace for a repository. The GitHub token and
   * the new access token live only in the running container. Returns the
   * path to open, with the access token.
   */
  async function start({ id, repo, githubToken, size = "standard", author = {} }) {
    const s = checkStart({ id, repo, githubToken, size });

    const accessToken = randomBytes(24).toString("base64url");
    const path = `${basePath}/${id}`;
    await docker.removeContainer(containerName(id));
    await docker.createVolume(volumeName(id), { [LABEL]: id });
    await docker.createContainer(containerName(id), {
      Image: image,
      Labels: { [LABEL]: id, "continuum.size": size, "continuum.repo": repo },
      Env: [
        `CONNECTION_TOKEN=${accessToken}`,
        `BASE_PATH=${path}`,
        `GIT_REPO=${repo}`,
        `GITHUB_TOKEN=${githubToken}`,
        `GIT_AUTHOR_NAME=${clean(author.name) || "Continuum user"}`,
        `GIT_AUTHOR_EMAIL=${clean(author.email) || "user@continuum.local"}`,
      ],
      HostConfig: {
        NetworkMode: network,
        Mounts: [{ Type: "volume", Source: volumeName(id), Target: "/home/workspace" }],
        NanoCpus: s.cpus * 1e9,
        Memory: s.memoryGb * 1024 ** 3,
        PidsLimit: 2048,
        // Never more rights than a normal user
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
        RestartPolicy: { Name: "no" },
        // A small init process: stop signals reach the editor (quick stops) and nothing is left behind
        Init: true,
      },
    });
    await docker.startContainer(containerName(id));
    tokens.set(id, accessToken);
    // Handed out once the editor answers (a fresh workspace also clones its repository first)
    const ready = await waitFor(() => probe(containerName(id), 3000), readyTimeoutMs);
    return { id, state: ready ? "running" : "starting", path: pathOf(id, accessToken) };
  }

  /** The way into a running workspace (null when it isn't running or its token is gone). */
  async function open(id) {
    check(id);
    const s = await status(id);
    const token = tokens.get(id);
    if (s.state === "stopped" || !token) return null;
    return { ...s, path: pathOf(id, token) };
  }

  /** Stops it: the container goes, the volume (code, settings) stays. */
  async function stop(id) {
    check(id);
    tokens.delete(id);
    await docker.stopContainer(containerName(id));
    await docker.removeContainer(containerName(id));
    return { id, state: "stopped" };
  }

  /** Deletes it: the container and the volume. */
  async function remove(id) {
    check(id);
    tokens.delete(id);
    await docker.removeContainer(containerName(id));
    await docker.removeVolume(volumeName(id));
    return { id, state: "deleted" };
  }

  /** Running workspaces (for the idle check and a restart of this service). */
  async function running() {
    const list = await docker.listContainers(LABEL);
    return list.filter((c) => c.State === "running").map((c) => c.Labels[LABEL]);
  }

  /** Where the proxy sends a workspace's traffic (its container on the Docker network). */
  const target = (id) => (ID.test(String(id)) ? { host: containerName(id), port: 3000 } : null);

  return { status, start, open, stop, remove, running, target };
}

/** One line, no control characters (for git's author settings). */
export function clean(s) {
  return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 100) : "";
}

/** Whether the editor answers at host:port (any HTTP answer counts). */
export function probeEditor(host, port) {
  return new Promise((resolve) => {
    const req = request({ host, port, path: "/", method: "HEAD", timeout: 2000 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
    req.end();
  });
}

export async function waitFor(check, timeoutMs, everyMs = 500) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return false;
}
