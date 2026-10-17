import { ADMIN_SECTIONS, useAdmin } from "./adminContext";
import "./admin.css";

/** Admin (left): its sections, with how many users and roles there are. */
export default function AdminNav() {
  const admin = useAdmin();
  if (!admin?.open) return null;
  const { section, setSection, users, roles } = admin;
  const count = { users: users.total, roles: roles.length };
  return (
    <nav className="admin-nav" aria-label="Admin">
      <h2 className="admin-nav-title">Admin</h2>
      <ul>
        {ADMIN_SECTIONS.map(([id, label, icon]) => (
          <li key={id}>
            <button type="button" className={section === id ? "is-on" : ""} aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}>
              <span className="admin-nav-icon" aria-hidden="true">{icon}</span>
              {label}
              {count[id] > 0 && <span className="admin-count">{count[id]}</span>}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
