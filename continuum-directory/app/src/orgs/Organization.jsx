import { useCallback, useEffect, useState } from "react";
import { orgsApi } from "../api";
import { useAuth } from "../auth";
import { ORG_ROLE_LABEL } from "./roles";
import "../admin/admin.css";
import "./Organization.css";

const ROLES = ["owner", "admin", "member", "viewer"];
const ROLE_ABOUT = {
  owner: "Everything, including other owners and deleting the organization",
  admin: "Members, invites, departments and every project",
  member: "Works on the projects of their departments (and those in none)",
  viewer: "Only looks at the projects of their departments",
};

/** Departments as toggles: the chosen ones are on. */
function DepartmentPicker({ departments, value, onChange, disabled, limitTo }) {
  if (!departments.length) return <span className="admin-muted">No departments yet</span>;
  return (
    <span className="org-depts">
      {departments.map((d) => {
        const on = value.includes(d.id);
        const allowed = !limitTo || limitTo.includes(d.id);
        return (
          <button
            key={d.id}
            type="button"
            className={`org-dept${on ? " is-on" : ""}`}
            aria-pressed={on}
            disabled={disabled || (!on && !allowed)}
            title={!allowed && !on ? "Only your own departments" : undefined}
            onClick={() => onChange(on ? value.filter((x) => x !== d.id) : [...value, d.id])}
          >
            {d.name}
          </button>
        );
      })}
    </span>
  );
}

/**
 * Your organization: its members (their organization role and departments),
 * invites, departments, and which departments see each project. Its owners
 * and admins change it; members and viewers see it. An organization's roles
 * are its own: they never make anyone Continuum's admin.
 */
export default function Organization({ orgId, onChanged, onGone }) {
  const { access: user } = useAuth();
  // The list on the left follows a new name or role; leaving or deleting goes back to it
  const reloadSpaces = async () => onChanged?.();
  const switchSpace = async () => onGone?.();
  const [org, setOrg] = useState(null);
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // what waits for "Yes"
  const [invite, setInvite] = useState({ email: "", orgRole: "member", departmentIds: [] });
  const [deptName, setDeptName] = useState("");
  const [renaming, setRenaming] = useState(null); // { kind: "org" | "dept", id?, name }

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      const [o, p] = await Promise.all([orgsApi.get(orgId), orgsApi.projects(orgId)]);
      setOrg(o);
      setProjects(p);
    } catch (err) {
      setError(err.message);
    }
  }, [orgId]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function run(fn, { reload = true } = {}) {
    setBusy(true);
    setError("");
    try {
      await fn();
      if (reload) await load();
    } catch (err) {
      setError(err?.message || "That didn't work.");
    }
    setBusy(false);
    setConfirm(null);
  }

  if (!org) return <section className="admin org">{error ? <p className="admin-error">{error}</p> : <p className="admin-muted">Loading…</p>}</section>;

  const me = String(user?.id);
  const manages = org.orgRole === "owner" || org.orgRole === "admin";
  const isOwner = org.orgRole === "owner";
  const deptName_ = (id) => org.departments.find((d) => d.id === id)?.name ?? "?";
  const myDepts = org.members.find((m) => m.userId === me)?.departmentIds ?? [];

  return (
    <section className="admin org" aria-label="Organization">
      <header className="admin-head">
        {renaming?.kind === "org" ? (
          <form className="admin-inline-form" onSubmit={(e) => (e.preventDefault(), run(async () => (await orgsApi.rename(orgId, renaming.name), setRenaming(null), await reloadSpaces())))}>
            <input autoFocus value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} maxLength={80} aria-label="Organization name" />
            <button type="submit" className="admin-btn is-primary" disabled={busy || !renaming.name.trim()}>
              Save
            </button>
            <button type="button" className="admin-btn" onClick={() => setRenaming(null)}>
              Cancel
            </button>
          </form>
        ) : (
          <>
            <h2>🏢 {org.name}</h2>
            {manages && (
              <button type="button" className="admin-link" onClick={() => setRenaming({ kind: "org", name: org.name })}>
                Rename
              </button>
            )}
          </>
        )}
        <span className="admin-muted">
          You're {/^[AEIOU]/.test(ORG_ROLE_LABEL[org.orgRole] ?? "") ? "an" : "a"} {ORG_ROLE_LABEL[org.orgRole]} here: {ROLE_ABOUT[org.orgRole]?.toLowerCase()}. An organization's roles are its own; they don't give Continuum admin.
        </span>
      </header>

      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}

      {/* Members */}
      <div className="org-card">
        <h3>Members ({org.members.length})</h3>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Who</th>
                <th>Role</th>
                <th>Departments</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {org.members.map((m) => {
                const self = m.userId === me;
                const canChange = manages && (isOwner || m.orgRole !== "owner");
                return (
                  <tr key={m.userId}>
                    <td>
                      <span className="admin-user-email">{m.email ?? m.userId}</span>
                      {m.name && <span className="admin-client">{m.name}</span>}
                      {self && <span className="admin-pill">you</span>}
                    </td>
                    <td>
                      {canChange ? (
                        <select value={m.orgRole} disabled={busy} aria-label={`Role of ${m.email}`} onChange={(e) => run(() => orgsApi.updateMember(orgId, m.userId, { orgRole: e.target.value }).then(() => self && reloadSpaces()))}>
                          {ROLES.filter((r) => isOwner || r !== "owner").map((r) => (
                            <option key={r} value={r}>
                              {ORG_ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        ORG_ROLE_LABEL[m.orgRole]
                      )}
                    </td>
                    <td>
                      {canChange ? (
                        <DepartmentPicker departments={org.departments} value={m.departmentIds} disabled={busy} onChange={(ids) => run(() => orgsApi.updateMember(orgId, m.userId, { departmentIds: ids }))} />
                      ) : m.departmentIds.length ? (
                        m.departmentIds.map(deptName_).join(", ")
                      ) : (
                        <span className="admin-muted">None</span>
                      )}
                    </td>
                    <td className="org-actions">
                      {confirm === `member:${m.userId}` ? (
                        <>
                          <button type="button" className="admin-btn" onClick={() => setConfirm(null)}>
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="admin-btn is-danger"
                            disabled={busy}
                            onClick={() => run(async () => (await orgsApi.removeMember(orgId, m.userId), self ? await switchSpace(`u:${me}`) : null), { reload: !self })}
                          >
                            {self ? "Yes, leave" : "Yes, remove"}
                          </button>
                        </>
                      ) : (
                        (self || canChange) && (
                          <button type="button" className="admin-btn is-danger" onClick={() => setConfirm(`member:${m.userId}`)}>
                            {self ? "Leave…" : "Remove…"}
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="admin-muted">Owners and admins see every project. Members and viewers see the projects of their departments, those in no department, and the ones they added.</p>
      </div>

      {/* Invites */}
      {manages && (
        <div className="org-card">
          <h3>Invite</h3>
          <form
            className="org-invite"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await orgsApi.invite(orgId, invite);
                setInvite({ email: "", orgRole: "member", departmentIds: [] });
              });
            }}
          >
            <input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} placeholder="Their email" aria-label="Email to invite" autoComplete="off" />
            <select value={invite.orgRole} onChange={(e) => setInvite({ ...invite, orgRole: e.target.value })} aria-label="Role">
              {ROLES.filter((r) => isOwner || r !== "owner").map((r) => (
                <option key={r} value={r}>
                  {ORG_ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            <DepartmentPicker departments={org.departments} value={invite.departmentIds} onChange={(ids) => setInvite({ ...invite, departmentIds: ids })} />
            <button type="submit" className="admin-btn is-primary" disabled={busy || !invite.email.trim()}>
              Invite
            </button>
          </form>
          <p className="admin-muted">They see the invite in the switcher at the top once they sign in to Continuum with that email (valid 14 days). No email is sent.</p>
          {org.invites?.length > 0 && (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <tbody>
                  {org.invites.map((i) => (
                    <tr key={i.id}>
                      <td>{i.email}</td>
                      <td>{ORG_ROLE_LABEL[i.orgRole]}</td>
                      <td>{i.departmentIds.length ? i.departmentIds.map(deptName_).join(", ") : <span className="admin-muted">No department</span>}</td>
                      <td className="admin-muted">until {new Date(i.expiresAt).toLocaleDateString()}</td>
                      <td className="org-actions">
                        <button type="button" className="admin-btn" disabled={busy} onClick={() => run(() => orgsApi.cancelInvite(orgId, i.id))}>
                          Cancel invite
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Departments */}
      <div className="org-card">
        <h3>Departments ({org.departments.length})</h3>
        {manages && (
          <form className="admin-inline-form" onSubmit={(e) => (e.preventDefault(), run(async () => (await orgsApi.addDepartment(orgId, deptName), setDeptName(""))))}>
            <input value={deptName} onChange={(e) => setDeptName(e.target.value)} placeholder="New department, e.g. Engineering" aria-label="Department name" maxLength={80} />
            <button type="submit" className="admin-btn" disabled={busy || !deptName.trim()}>
              Add department
            </button>
          </form>
        )}
        {org.departments.length === 0 ? (
          <p className="admin-muted">None yet: every member sees every project.</p>
        ) : (
          <ul className="org-dept-list">
            {org.departments.map((d) => (
              <li key={d.id}>
                {renaming?.kind === "dept" && renaming.id === d.id ? (
                  <form className="admin-inline-form" onSubmit={(e) => (e.preventDefault(), run(async () => (await orgsApi.renameDepartment(orgId, d.id, renaming.name), setRenaming(null))))}>
                    <input autoFocus value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} maxLength={80} aria-label="Department name" />
                    <button type="submit" className="admin-btn is-primary" disabled={busy || !renaming.name.trim()}>
                      Save
                    </button>
                    <button type="button" className="admin-btn" onClick={() => setRenaming(null)}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <span className="org-dept-name">{d.name}</span>
                    <span className="admin-muted">
                      {org.members.filter((m) => m.departmentIds.includes(d.id)).length} people · {projects.filter((p) => p.departmentIds.includes(d.id)).length} projects
                    </span>
                    {manages && (
                      <span className="org-actions">
                        <button type="button" className="admin-link" onClick={() => setRenaming({ kind: "dept", id: d.id, name: d.name })}>
                          Rename
                        </button>
                        {confirm === `dept:${d.id}` ? (
                          <>
                            <button type="button" className="admin-btn" onClick={() => setConfirm(null)}>
                              Cancel
                            </button>
                            <button type="button" className="admin-btn is-danger" disabled={busy} onClick={() => run(() => orgsApi.removeDepartment(orgId, d.id))}>
                              Yes, delete
                            </button>
                          </>
                        ) : (
                          <button type="button" className="admin-link" onClick={() => setConfirm(`dept:${d.id}`)}>
                            Delete…
                          </button>
                        )}
                      </span>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Projects and who sees them */}
      <div className="org-card">
        <h3>Projects ({projects.length}{manages ? "" : " you see"})</h3>
        {projects.length === 0 ? (
          <p className="admin-muted">No projects here yet. In Continuum, choose this organization in the switcher at the top: new projects and imports then go into it.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Added by</th>
                  <th>Seen by</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const adder = org.members.find((m) => m.userId === p.userId);
                  const canSet = org.orgRole !== "viewer" && (manages || p.userId === me);
                  return (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>{adder?.email ?? <span className="admin-muted">someone who left</span>}</td>
                      <td>
                        {canSet ? (
                          <DepartmentPicker
                            departments={org.departments}
                            value={p.departmentIds}
                            disabled={busy}
                            limitTo={manages ? null : myDepts}
                            onChange={(ids) => run(() => orgsApi.setProjectDepartments(orgId, p.id, ids))}
                          />
                        ) : p.departmentIds.length ? (
                          p.departmentIds.map(deptName_).join(", ")
                        ) : null}
                        {p.departmentIds.length === 0 && <span className="admin-muted org-everyone">every member</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isOwner && (
        <div className="org-card org-danger">
          <h3>Delete the organization</h3>
          <p className="admin-muted">Only while it has no projects, so nothing of anyone's is lost. Its members, departments and invites go with it.</p>
          {confirm === "delete-org" ? (
            <div className="org-confirm">
              <span className="admin-muted">Delete {org.name}?</span>
              <button type="button" className="admin-btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button type="button" className="admin-btn is-danger" disabled={busy} onClick={() => run(async () => (await orgsApi.remove(orgId), await switchSpace(`u:${me}`)), { reload: false })}>
                Yes, delete
              </button>
            </div>
          ) : (
            <button type="button" className="admin-btn is-danger" disabled={org.projects > 0} title={org.projects > 0 ? `It still has ${org.projects} projects` : undefined} onClick={() => setConfirm("delete-org")}>
              Delete organization…
            </button>
          )}
        </div>
      )}
    </section>
  );
}
