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
 */
export function sharedFeed(name, start, onMessage, { keep = 400, onJoin } = {}) {
  if (typeof BroadcastChannel === "undefined" || !navigator.locks?.request) {
    return start(onMessage);
  }
  const channel = new BroadcastChannel(name);
  const recent = []; // the holder's last messages, for tabs that join
  let holding = false;
  let stop = null;
  let left = false;
  const quit = new AbortController();

  const remember = (m) => {
    recent.push(m);
    if (recent.length > keep) recent.shift();
  };

  channel.onmessage = (e) => {
    const d = e.data;
    if (d?.type === "message") onMessage(d.message);
    else if (d?.type === "hello" && holding) channel.postMessage({ type: "recent", messages: recent });
    else if (d?.type === "recent" && !holding) d.messages.forEach(onMessage);
  };

  // Wait to hold the feed; until then (or if never), messages come from the holder
  navigator.locks
    .request(name, { signal: quit.signal }, () => {
      if (left) return undefined;
      holding = true;
      stop = start((message) => {
        remember(message);
        onMessage(message);
        channel.postMessage({ type: "message", message });
      });
      // Held until this tab leaves the feed (or closes: the browser lets go of it)
      return new Promise((resolve) => quit.signal.addEventListener("abort", resolve));
    })
    .catch(() => {}); // aborted while waiting

  // Joining: catch up with what the holder has, and let the screen refresh itself
  channel.postMessage({ type: "hello" });
  onJoin?.();

  return () => {
    left = true;
    stop?.();
    stop = null;
    holding = false;
    quit.abort();
    channel.close();
  };
}
