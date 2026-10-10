import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../state/authStore";
import "./ShellHeader.css";

export default function ShellHeader({ onManualCreate }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  function toggleMenu() {
    setOpen((o) => !o);
  }

  function handleBackstage() {
    window.open("http://localhost:3000/create", "_blank");
    setOpen(false);
  }

  function handleExternalCreate() {
  window.open("http://localhost:3000/create", "_blank");
  setOpen(false);
}

  function handleManual() {
    onManualCreate?.();
    setOpen(false);
  }

  return (
    <header className="shell-header">
      <Link to="/" className="shell-title">
        Continuum Console
      </Link>

      <div className="shell-user">
        {/* 🔥 NEW MENU */}
        <div className="create-project-menu">
          <button onClick={toggleMenu} className="menu-trigger">
            + Create ▾
          </button>

          {open && (
            <div className="menu-dropdown">
              <button onClick={handleExternalCreate}>
                🚀 Create via Backstage
              </button>

              <button onClick={handleManual}>
                📝 Create Manually
              </button>

              <button disabled>
                📦 Import Repo (Github)
              </button>
            </div>
          )}
        </div>

        <Link to="/help" className="shell-help">
          Help
        </Link>

        <span className="shell-email">{user?.email}</span>

        <button className="shell-signout" onClick={logout}>
          Sign out
        </button>
      </div>
    </header>
  );
}