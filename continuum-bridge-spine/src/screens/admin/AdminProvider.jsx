import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi } from "../../api";
import { useAuth } from "../../state/authStore";
import { AdminContext } from "./adminContext";

/**
 * The admin area's state: the section showing, the users list (and its
 * search and filters), roles, the default role, sign-ins, admin changes, and
 * what's selected (a user or a role, shown on the right). Only for admins:
 * for anyone else nothing loads (the screen says "No feature access").
 */
export function AdminProvider({ children }) {
  const { status, can, access } = useAuth();
  const open = status === "authenticated" && can("admin") && !!access && !access.legacy;
  const [section, setSection] = useState("users");
  const [query, setQuery] = useState({ search: "", role: "", status: "", seenDays: "", sort: "created", page: 1 });
  const [users, setUsers] = useState({ users: [], total: 0, page: 1, pageSize: 50 });
  const [roles, setRoles] = useState([]);
  const [features, setFeatures] = useState([]);
  const [settings, setSettings] = useState(null);
  const [signins, setSignins] = useState(null);
  const [changes, setChanges] = useState(null);
  const [selected, setSelected] = useState(null); // { kind: "user" | "role", id }
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true); // until the first list arrives

  const fail = (err) => setError(err.message || "Something went wrong.");

  const loadUsers = useCallback(
    (q = query) => {
      setLoading(true);
      return adminApi
        .users(q)
        .then((r) => (setUsers(r), setError("")))
        .catch(fail)
        .finally(() => setLoading(false));
    },
    [query]
  );
  const loadRoles = useCallback(() => Promise.all([adminApi.roles(), adminApi.settings()]).then(([r, s]) => (setRoles(r), setSettings(s))).catch(fail), []);

  useEffect(() => {
    if (!open) return;
    adminApi.features().then(setFeatures).catch(fail);
    loadRoles();
  }, [open, loadRoles]);

  // The users list follows its search and filters (a short pause while typing)
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => loadUsers(query), 250);
    return () => clearTimeout(t);
  }, [open, query, loadUsers]);

  useEffect(() => {
    if (!open) return;
    if (section === "signins") adminApi.activity().then(setSignins).catch(fail);
    if (section === "changes") adminApi.changes().then(setChanges).catch(fail);
  }, [open, section]);

  const value = useMemo(
    () => ({
      open,
      section,
      setSection: (s) => (setSection(s), setSelected(null)),
      query,
      setQuery: (changes) => setQuery((q) => ({ ...q, page: 1, ...changes })),
      users,
      roles,
      features,
      settings,
      signins,
      changes,
      selected,
      select: (kind, id) => setSelected(kind ? { kind, id } : null),
      error,
      clearError: () => setError(""),
      loading,
      refresh: () => Promise.all([loadUsers(), loadRoles()]),

      /** A user's role or disabled state; the lists follow. Throws when refused. */
      async updateUser(id, changes) {
        const u = await adminApi.updateUser(id, changes);
        await Promise.all([loadUsers(), loadRoles()]);
        return u;
      },
      /**
       * Switches one feature of a role on or off. Turning an app on gives all
       * of its features (switch off what isn't wanted); off, they all stop.
       */
      async toggleFeature(role, feature, on) {
        const children = features.filter((f) => f.parent === feature).map((f) => f.id);
        const next = on ? [...new Set([...role.features, feature, ...children])] : role.features.filter((f) => f !== feature && !children.includes(f));
        setRoles((rs) => rs.map((r) => (r.id === role.id ? { ...r, features: next } : r))); // at once; put right on failure
        try {
          await adminApi.updateRole(role.id, { features: next });
        } catch (err) {
          fail(err);
        }
        await loadRoles();
      },
      async createRole(role) {
        const r = await adminApi.createRole(role);
        await loadRoles();
        return r;
      },
      async updateRole(id, changes) {
        const r = await adminApi.updateRole(id, changes);
        await loadRoles();
        return r;
      },
      async deleteRole(id, moveTo) {
        const r = await adminApi.deleteRole(id, moveTo);
        setSelected(null);
        await Promise.all([loadUsers(), loadRoles()]);
        return r;
      },
      async setDefaultRole(id) {
        setSettings(await adminApi.saveSettings({ defaultRoleId: id }));
        await loadRoles();
      },
    }),
    [open, section, query, users, roles, features, settings, signins, changes, selected, error, loading, loadUsers, loadRoles]
  );

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}
