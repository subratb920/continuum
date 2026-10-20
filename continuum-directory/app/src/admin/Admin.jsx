import { lazy, Suspense } from "react";
import { useAuth } from "../auth";
import { AdminProvider } from "./AdminProvider";
import { useAdmin } from "./adminContext";
import "./admin.css";

const AdminMain = lazy(() => import("./AdminMain"));
const AdminDetail = lazy(() => import("./AdminDetail"));
const AdminClaim = lazy(() => import("./AdminClaim"));

/**
 * Continuum's admin area (the admin feature only): users of every kind,
 * roles, sign-ins, what admins changed, and production sync. Without any
 * admin yet, the first one claims it with the setup code from the API's log.
 */
export default function Admin({ section, onSection }) {
  const { access, can } = useAuth();
  if (!can("admin")) {
    if (access?.adminSetup) {
      return (
        <Suspense fallback={null}>
          <AdminClaim />
        </Suspense>
      );
    }
    return (
      <section className="admin org">
        <p className="admin-hint">No feature access: Admin isn't switched on for your role. Continuum's admins manage users and roles here; an organization's admins don't.</p>
      </section>
    );
  }
  return (
    <AdminProvider section={section} onSection={onSection}>
      <AdminPanes />
    </AdminProvider>
  );
}

function AdminPanes() {
  const admin = useAdmin();
  return (
    <div className="dir-split is-three">
      <div className="dir-main">
        <Suspense fallback={<p className="admin-muted">Loading…</p>}>
          <AdminMain />
        </Suspense>
      </div>
      {admin.selected && (
        <aside className="dir-detail" aria-label="Details">
          <Suspense fallback={null}>
            <AdminDetail />
          </Suspense>
        </aside>
      )}
    </div>
  );
}
