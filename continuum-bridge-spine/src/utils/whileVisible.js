/**
 * Keeps a live connection open only while this tab is visible. Browsers allow
 * about 6 connections to one address across all tabs; each Continuum tab holds
 * live feeds, so a few open tabs used to leave no room for ordinary requests
 * (clicks that never reached the server). A tab in the background closes its
 * feed after a short while (a quick tab switch keeps it) and opens it again
 * when it's back: the feed then catches up on what it missed.
 *
 * start() opens the connection and returns a function that closes it.
 * Returns a function that stops everything.
 */
const GRACE_MS = 30_000;

export function whileVisible(start, { graceMs = GRACE_MS } = {}) {
  let stop = null;
  let timer = null;
  let disposed = false;

  const open = () => {
    if (!stop && !disposed) stop = start();
  };
  const close = () => {
    stop?.();
    stop = null;
  };
  const onChange = () => {
    clearTimeout(timer);
    if (document.visibilityState === "visible") open();
    else timer = setTimeout(close, graceMs);
  };

  document.addEventListener("visibilitychange", onChange);
  // A tab opened in the background connects when it's first shown
  if (document.visibilityState === "visible") open();

  return () => {
    disposed = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onChange);
    close();
  };
}
