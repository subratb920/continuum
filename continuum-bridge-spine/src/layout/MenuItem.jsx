import { useAuth } from "../state/authStore";
import { LockMark } from "../components/NoAccess";
import "./menuItems.css";

/** One item in a header menu */
export default function MenuItem({ item }) {
  const { can } = useAuth();
  // Its feature switched off: still shown (locked); choosing it opens "No feature access"
  const locked = item.feature && !can(item.feature);
  return (
    <>
      {item.divider && <div className="menu-divider" role="separator" />}
      <button type="button" role="menuitem" className="menu-item" onClick={item.onClick} disabled={item.disabled}>
        <span className="menu-item-icon" aria-hidden="true">
          {item.icon}
        </span>
        <span className="menu-item-text">
          <span className="menu-item-title">
            {item.title}
            {locked && <LockMark feature={item.feature} />}
          </span>
          <span className="menu-item-hint">{locked ? "No feature access" : item.hint}</span>
        </span>
      </button>
    </>
  );
}
