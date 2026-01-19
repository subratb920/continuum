import { useAuth } from "../state/authStore";
import "./ShellHeader.css";

export default function ShellHeader() {
  const { user, logout } = useAuth();

  return (
    <header className="shell-header">
      <div className="shell-title">Continuum Console</div>

      <div className="shell-user">
        <span className="shell-email">{user?.email}</span>
        <button className="shell-signout" onClick={logout}>
          Sign out
        </button>
      </div>
    </header>
  );
}
