/**
 * One live connection per browser, shared by every Continuum tab. Browsers
 * allow about 6 connections to one address over HTTP/1.1 (Continuum locally),
 * and each tab holding its own feeds used them all up: nothing else could
 * load. Now one tab (the holder, chosen with a Web Lock) keeps the feed open
 * and passes each message to the other tabs (BroadcastChannel); when it
 * closes, another tab takes over. A tab that joins asks the holder for the
 * recent messages, so it starts with what the others already have.
 *
 * start(emit) opens the real connection and returns a function that closes
 * it; emit(message) hands a message to every tab. onMessage receives them in
 * this tab. Returns a function that leaves the feed.
 *
 * Browsers without Web Locks or BroadcastChannel: each tab opens its own.
 * A holder that doesn't answer (a background tab a phone has frozen, still
 * holding the lock) isn't waited for: after a few seconds of silence this tab
 * opens its own connection (the screen drops repeated messages).
 */
const HOLDER_SILENT_MS = 4000;

export function sharedFeed(name, start, onMessage, { keep = 400, onJoin } = {}) {
  if (typeof BroadcastChannel === "undefined" || !navigator.locks?.request) {
    return start(onMessage);
  }
  const channel = new BroadcastChannel(name);
  const recent = []; // the holder's last messages, for tabs that join
  let holding = false;
  let stop = null;
  let left = false;
  let heard = false; // the holder answered (or sent something)
  const quit = new AbortController();

  const remember = (m) => {
    recent.push(m);
    if (recent.length > keep) recent.shift();
  };

  // This tab's own connection (as the holder, or on its own when the holder is silent)
  const own = () => {
    stop ??= start((message) => {
      remember(message);
      onMessage(message);
      if (holding) channel.postMessage({ type: "message", message });
    });
  };

  channel.onmessage = (e) => {
    const d = e.data;
    if (d?.type === "message" || d?.type === "recent") heard = true;
    if (d?.type === "message" && !stop) onMessage(d.message);
    else if (d?.type === "hello" && holding) channel.postMessage({ type: "recent", messages: recent });
    else if (d?.type === "recent" && !stop) d.messages.forEach(onMessage);
  };

  // Wait to hold the feed; until then (or if never), messages come from the holder
  navigator.locks
    .request(name, { signal: quit.signal }, () => {
      if (left) return undefined;
      holding = true;
      own(); // (already open if the last holder had gone silent)
      // Held until this tab leaves the feed (or closes: the browser lets go of it)
      return new Promise((resolve) => quit.signal.addEventListener("abort", resolve));
    })
    .catch(() => {}); // aborted while waiting

  // Joining: catch up with what the holder has, and let the screen refresh itself
  channel.postMessage({ type: "hello" });
  onJoin?.();
  // A holder that stays silent (frozen in the background): don't wait on it
  const silent = setTimeout(() => !left && !holding && !heard && own(), HOLDER_SILENT_MS);

  return () => {
    left = true;
    clearTimeout(silent);
    stop?.();
    stop = null;
    holding = false;
    quit.abort();
    channel.close();
  };
}
