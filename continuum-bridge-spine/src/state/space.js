// The space you're working in: your personal space ("u:<your id>") or an
// organization ("o:<its id>"). Every request about projects says which
// (X-Continuum-Space); the server checks you're in it. Remembered per account
// in this browser (and on your account, for other devices).

const KEY = "continuum.space";

/** An organization's roles (its own: they never make anyone Continuum's admin). */
export const ORG_ROLE_LABEL = { owner: "Owner", admin: "Admin", member: "Member", viewer: "Viewer" };
export const SPACE_EVENT = "continuum:space";

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
}

let current = read(); // { userId, spaceId } | null

/** Chosen in this browser for this account (a new device: not yet). */
export const chosenHere = (userId) => Boolean(current && current.userId === String(userId));

/** Signed in as someone else: their choice isn't yours. */
export function forgetOtherAccount(userId) {
  if (current && current.userId !== String(userId)) {
    current = null;
    try {
      localStorage.removeItem(KEY);
    } catch {
      // nothing kept
    }
  }
}

/** The space for this account ("u:…" / "o:…"), or null (personal). */
export function getSpace(userId) {
  if (!current) return null;
  return userId && current.userId !== String(userId) ? null : current.spaceId;
}

/** Work in this space from now on (in this tab and others). */
export function setSpace(userId, spaceId) {
  current = spaceId ? { userId: String(userId), spaceId } : null;
  try {
    if (current) localStorage.setItem(KEY, JSON.stringify(current));
    else localStorage.removeItem(KEY);
  } catch {
    // remembered while the page is open
  }
  window.dispatchEvent(new CustomEvent(SPACE_EVENT, { detail: spaceId }));
}

/** The header that says which space a request is about (none: personal). */
export function spaceHeaders() {
  return current?.spaceId?.startsWith("o:") ? { "X-Continuum-Space": current.spaceId } : {};
}

/** The server said you're not in that space (left, removed): back to personal, and the page loads again for it. */
export function leftSpace() {
  if (!current?.spaceId?.startsWith("o:")) return;
  setSpace(current.userId, `u:${current.userId}`);
  window.location.reload();
}
