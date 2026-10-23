import { API_BASE } from "./config";
import { accessToken, signIn } from "./session";

/** A call to continuum-api with this tab's Directory sign-in; refreshed once if it ran out. */
export async function request(method, path, body) {
  for (const force of [false, true]) {
    const token = await accessToken({ force });
    if (!token) {
      await signIn();
      throw new Error("Signing in…");
    }
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && !force) continue;
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (res.status === 401) {
      await signIn();
      throw new Error("Signing in…");
    }
    if (!res.ok) throw Object.assign(new Error(data?.error || "That didn't work."), { code: data?.code ?? null, field: data?.field ?? null });
    return data;
  }
  return null;
}

const q = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== "" && v != null));

/** You, your spaces and invites. */
export const meApi = {
  get: () => request("GET", "/directory/me"),
  spaces: () => request("GET", "/directory/me/spaces"),
  acceptInvite: (id) => request("POST", `/directory/me/invites/${id}/accept`),
  declineInvite: (id) => request("POST", `/directory/me/invites/${id}/decline`),
  claimAdmin: (code) => request("POST", "/directory/me/claim-admin", { code }),
};

/** Organizations (their roles are their own: an organization's admin isn't Continuum's admin). */
export const orgsApi = {
  create: (name) => request("POST", "/directory/orgs", { name }),
  get: (orgId) => request("GET", `/directory/orgs/${orgId}`),
  rename: (orgId, name) => request("PATCH", `/directory/orgs/${orgId}`, { name }),
  remove: (orgId) => request("DELETE", `/directory/orgs/${orgId}`),
  addDepartment: (orgId, name) => request("POST", `/directory/orgs/${orgId}/departments`, { name }),
  renameDepartment: (orgId, id, name) => request("PATCH", `/directory/orgs/${orgId}/departments/${id}`, { name }),
  removeDepartment: (orgId, id) => request("DELETE", `/directory/orgs/${orgId}/departments/${id}`),
  updateMember: (orgId, userId, changes) => request("PATCH", `/directory/orgs/${orgId}/members/${userId}`, changes),
  removeMember: (orgId, userId) => request("DELETE", `/directory/orgs/${orgId}/members/${userId}`),
  invite: (orgId, invite) => request("POST", `/directory/orgs/${orgId}/invites`, invite),
  cancelInvite: (orgId, id) => request("DELETE", `/directory/orgs/${orgId}/invites/${id}`),
  // The organization's projects (they're Continuum's) and which departments see each
  projects: (orgId) => request("GET", `/directory/orgs/${orgId}/projects`),
  setProjectDepartments: (orgId, projectId, departmentIds) => request("PUT", `/directory/orgs/${orgId}/projects/${projectId}/departments`, { departmentIds }),
};

/** Continuum's admins: users, roles, sign-ins, changes, production sync. */
export const adminApi = {
  features: () => request("GET", "/directory/admin/features"),
  users: (query = {}) => request("GET", `/directory/admin/users?${q(query)}`),
  user: (id) => request("GET", `/directory/admin/users/${id}`),
  updateUser: (id, changes) => request("PATCH", `/directory/admin/users/${id}`, changes),
  signOutUser: (id) => request("POST", `/directory/admin/users/${id}/signout`),
  roles: () => request("GET", "/directory/admin/roles"),
  createRole: (role) => request("POST", "/directory/admin/roles", role),
  updateRole: (id, changes) => request("PATCH", `/directory/admin/roles/${encodeURIComponent(id)}`, changes),
  deleteRole: (id, moveTo) => request("DELETE", `/directory/admin/roles/${encodeURIComponent(id)}?moveTo=${encodeURIComponent(moveTo)}`),
  settings: () => request("GET", "/directory/admin/settings"),
  saveSettings: (s) => request("PUT", "/directory/admin/settings", s),
  activity: ({ failed = false } = {}) => request("GET", `/directory/admin/activity?limit=200${failed ? "&failed=1" : ""}`),
  changes: () => request("GET", "/directory/admin/changes?limit=200"),
  syncPreview: () => request("POST", "/admin/sync/preview"),
  syncPush: (target, code) => request("POST", "/admin/sync/push", { target, code }),
  createSyncCode: () => request("POST", "/me/sync-codes"),
  // Operator brain control: start/stop + compute limits, global and per-user
  brainOverview: () => request("GET", "/admin/brain/overview"),
  brainStopAll: () => request("POST", "/admin/brain/stop-all"),
  brainResume: () => request("POST", "/admin/brain/resume"),
  brainSetLimits: (limits) => request("PUT", "/admin/brain/limits", limits),
  brainUser: (id) => request("GET", `/admin/brain/users/${id}`),
  brainStopUser: (id) => request("POST", `/admin/brain/users/${id}/stop`),
  brainSetUser: (id, patch) => request("PUT", `/admin/brain/users/${id}`, patch),
  // Contact us's callback requests (kept by Continuum)
  callbacks: (status = "") => request("GET", `/directory/admin/callbacks?${q({ status })}`),
  markCallback: (id, status) => request("PATCH", `/directory/admin/callbacks/${id}`, { status }),
  // Public-site visitor analytics (anonymous) and the leads it captured
  visits: ({ from = "", to = "" } = {}) => request("GET", `/directory/admin/visits?${q({ from, to })}`),
  journeys: ({ from = "", to = "" } = {}) => request("GET", `/directory/admin/visits/journeys?${q({ from, to })}`),
  leads: (status = "") => request("GET", `/directory/admin/leads?${q({ status })}`),
  markLead: (id, status) => request("PATCH", `/directory/admin/leads/${id}`, { status }),
};
