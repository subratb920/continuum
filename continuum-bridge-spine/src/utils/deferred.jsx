import { lazy, Suspense } from "react";

// Every screen, page and dialog loads on first use (its own file), so the
// first page needs only what it shows. Each has its own Suspense boundary:
// one loading never blanks the rest of the page. Once the page has drawn and
// the browser is idle, the others are fetched quietly, so opening one later
// doesn't wait.

const loaders = new Set();
let scheduled = false;

function prefetchWhenIdle() {
  if (scheduled || typeof window === "undefined") return;
  scheduled = true;
  const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 2000));
  const next = () => {
    const [load] = loaders;
    if (!load) return;
    loaders.delete(load);
    load()
      .catch(() => {}) // fetched again when it's opened
      .finally(() => idle(next));
  };
  window.addEventListener("load", () => idle(next), { once: true });
  if (document.readyState === "complete") idle(next);
}

/**
 * A component loaded on first use: deferred(() => import("./X")), or a named
 * export: deferred(() => import("./X"), "Name"). fallback: what shows while it loads.
 */
export function deferred(loader, name = "default", fallback = null) {
  const load = name === "default" ? loader : () => loader().then((m) => ({ default: m[name] }));
  const Lazy = lazy(load);
  loaders.add(load);
  prefetchWhenIdle();
  function Deferred(props) {
    return (
      <Suspense fallback={fallback}>
        <Lazy {...props} />
      </Suspense>
    );
  }
  Deferred.displayName = `Deferred(${name})`;
  return Deferred;
}
