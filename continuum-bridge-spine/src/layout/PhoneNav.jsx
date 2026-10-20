import { useLocation, useNavigate } from "react-router-dom";
import { screenForPath } from "../screens/registry";
import { SWITCHER } from "../screens/switcher";
import { usePanels } from "./PanelsContext";
import { rememberedPart } from "./parts";

import "./PhoneNav.css";

/**
 * Small screens only (under 900px; hidden above by CSS), under the header:
 * - the screen tabs (Interval · Agents · Data, from screens/registry.jsx),
 *   on every signed-in page, each with its badge; a tab brings back the part
 *   that screen was showing;
 * - on a console screen, the parts bar: the part showing in the middle, its
 *   neighbours on their own side (‹ Projects [Interval Setup] Bridges ›).
 *   It slides along with the parts; a neighbour opens that part.
 */
export default function PhoneNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const panels = usePanels();
  const screen = screenForPath(pathname);
  const tabs = SWITCHER;

  function go(s) {
    if (s === screen) return panels.close();
    const part = rememberedPart(s.id);
    navigate(s.path, part ? { state: { part } } : undefined);
  }

  return (
    <div className="phone-nav">
      <nav className="phone-tabs" aria-label="Screens">
        {tabs.map((s) => (
          <PhoneTab key={s.id} screen={s} current={s === screen} onClick={() => go(s)} />
        ))}
      </nav>
      {/* A full-width screen (Chat) has no parts: only the tabs above it */}
      {panels.enabled && screen && !(screen.full && !panels.panel) && <PartsBar screen={screen} panels={panels} />}
    </div>
  );
}

function PhoneTab({ screen, current, onClick }) {
  const badge = screen.useBadge?.() ?? 0;
  return (
    <button type="button" className="phone-tab" aria-current={current ? "page" : undefined} onClick={onClick}>
      <span className="phone-tab-label">{screen.label === "Interval Setup" ? "Interval" : screen.label}</span>
      {badge > 0 && (
        <span className="phone-tab-badge" aria-label={`${badge} waiting`}>
          {badge}
        </span>
      )}
    </button>
  );
}

/** Where each part sits on the strip: its slot (0 left, 1 middle, 2 right). */
const SLOT = { left: 0, center: 1, right: 2 };

function PartsBar({ screen, panels }) {
  const extra = panels.panel === "create" || panels.panel === "deploy" ? panels.panel : null;
  if (extra) {
    // Create/Import or Deploy fills the middle: back to the screen on the left
    return (
      <div className="parts-bar" aria-label="Parts of this screen">
        <div className="parts-strip">
          <button type="button" className="parts-label is-side" onClick={panels.close}>
            ‹ {screen.center.label}
          </button>
          <span className="parts-label is-current" aria-current="true">
            {extra === "create" ? "Create/Import" : "Deploy"}
          </span>
          <span className="parts-label" aria-hidden="true" />
        </div>
      </div>
    );
  }
  const current = panels.panel === "left" || panels.panel === "right" ? panels.panel : "center";
  // The strip holds left · middle · right; it moves (with the parts, PageShell's --part-pos) so the current part sits in the middle slot
  const part = (id) => {
    const label = screen[id].label;
    const here = id === current;
    const near = Math.abs(SLOT[id] - SLOT[current]) === 1;
    if (here) {
      return (
        <span key={id} className="parts-label is-current" aria-current="true">
          {label}
        </span>
      );
    }
    return (
      <button
        key={id}
        type="button"
        className={`parts-label is-side${near ? "" : " is-hidden"}`}
        tabIndex={near ? 0 : -1}
        aria-hidden={near ? undefined : "true"}
        onClick={() => (id === "center" ? panels.close() : panels.open(id))}
      >
        {SLOT[id] < SLOT[current] ? `‹ ${label}` : `${label} ›`}
      </button>
    );
  };
  return (
    <div className="parts-bar" aria-label="Parts of this screen">
      <div className="parts-strip">
        {part("left")}
        {part("center")}
        {part("right")}
      </div>
    </div>
  );
}
