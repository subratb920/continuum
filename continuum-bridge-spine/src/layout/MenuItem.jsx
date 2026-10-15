import "./menuItems.css";

/** One item in a header menu */
export default function MenuItem({ item }) {
  return (
    <>
      {item.divider && <div className="menu-divider" role="separator" />}
      <button type="button" role="menuitem" className="menu-item" onClick={item.onClick} disabled={item.disabled}>
        <span className="menu-item-icon" aria-hidden="true">
          {item.icon}
        </span>
        <span className="menu-item-text">
          <span className="menu-item-title">{item.title}</span>
          <span className="menu-item-hint">{item.hint}</span>
        </span>
      </button>
    </>
  );
}
