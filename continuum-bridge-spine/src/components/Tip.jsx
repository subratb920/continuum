import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./Tip.css";

const SHOW_AFTER_MS = 350;
const GAP = 8;
const EDGE = 8;

/**
 * A small tooltip for an icon button or link: shown after a short hover, at
 * once on keyboard focus; hidden on leave, blur, Escape or scroll. Drawn in a
 * layer above the page (never cut off by a scrolling pane), above the icon or
 * below it near the top, and kept on screen. The text also describes the icon
 * to screen readers (aria-describedby).
 *   <Tip text="Open on GitHub" detail="octo/app"><a …>…</a></Tip>
 */
export default function Tip({ text, detail, children }) {
  const id = useId();
  const timer = useRef(null);
  const [pos, setPos] = useState(null); // { top, left, below }

  function place(el) {
    if (!el?.isConnected) return;
    const r = el.getBoundingClientRect();
    const below = r.top < 56;
    setPos({ top: below ? r.bottom + GAP : r.top - GAP, left: r.left + r.width / 2, below });
  }
  const show = (el, delay) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => place(el), delay);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setPos(null);
  };

  useEffect(() => {
    if (!pos) return;
    const onKey = (e) => e.key === "Escape" && hide();
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [pos]);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Keep it inside the window once its width is known (moved on the element itself, arrow stays on the icon)
  const tipRef = useRef(null);
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!pos || !el) return;
    const w = el.offsetWidth;
    const left = pos.left - w / 2;
    const right = pos.left + w / 2;
    const shift = left < EDGE ? EDGE - left : right > window.innerWidth - EDGE ? window.innerWidth - EDGE - right : 0;
    el.style.left = `${pos.left + shift}px`;
    el.style.setProperty("--tip-arrow", `${-shift}px`);
  }, [pos]);

  // The icon itself is unchanged; it only gains the tooltip's description
  const child = cloneElement(children, { "aria-describedby": pos ? id : undefined });

  return (
    <span
      className="tip-anchor"
      onMouseEnter={(e) => show(e.currentTarget, SHOW_AFTER_MS)}
      onMouseLeave={hide}
      onFocus={(e) => e.target.matches(":focus-visible") && show(e.currentTarget, 0)}
      onBlur={hide}
      onClick={hide}
    >
      {child}
      {pos &&
        createPortal(
          <span
            ref={tipRef}
            id={id}
            role="tooltip"
            className={`tip${pos.below ? " tip-below" : ""}`}
            style={{ top: pos.top, left: pos.left }}
          >
            <span className="tip-text">{text}</span>
            {detail && <span className="tip-detail">{detail}</span>}
          </span>,
          document.body,
        )}
    </span>
  );
}
