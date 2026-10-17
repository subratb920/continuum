import { useAuth } from "../state/authStore";
import "./NoAccess.css";

/**
 * "No feature access": what a feature your role has switched off shows
 * instead (a screen, a page, an action). compact: a side pane's short note.
 */
export default function NoAccess({ feature, compact = false }) {
  const { access, featureName } = useAuth();
  const name = featureName(feature);
  if (compact) return <p className="no-access-note">No feature access</p>;
  return (
    <div className="no-access" role="status">
      <div className="no-access-card">
        <span className="no-access-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" focusable="false">
            <rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </span>
        <h2>No feature access</h2>
        <p>
          <strong>{name}</strong> isn't switched on for your role{access?.role?.name ? ` (${access.role.name})` : ""}.
        </p>
        <p className="no-access-hint">{access?.disabled ? "Your account is disabled. Ask your admin." : `Ask your admin to switch on ${name} for your role.`}</p>
      </div>
    </div>
  );
}

/** Shows the feature when your role has it, else "No feature access". */
export function FeatureGate({ feature, children }) {
  const { can } = useAuth();
  return can(feature) ? children : <NoAccess feature={feature} />;
}

/** "🔒" beside what your role has switched off (a button, a menu item). */
export function LockMark({ feature }) {
  const { can } = useAuth();
  if (can(feature)) return null;
  return (
    <span className="lock-mark" title="No feature access" aria-label="No feature access">
      🔒
    </span>
  );
}
