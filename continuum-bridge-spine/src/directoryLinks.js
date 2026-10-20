// Links into Continuum Directory (continuum-directory-app, its own address,
// e.g. http://localhost:45194): it signs you in through Continuum and opens in
// a new tab. Unset (VITE_DIRECTORY_URL): no link.
const DIRECTORY_URL = String(import.meta.env.VITE_DIRECTORY_URL || "").replace(/\/+$/, "");

/** Whether this setup has a Directory. */
export const DIRECTORY_AVAILABLE = Boolean(DIRECTORY_URL);

/** Opens the Directory in a new tab: a section ("users", "organizations"…), optionally one organization. */
export function openDirectory(section = "organizations", orgId = null) {
  if (!DIRECTORY_URL) return;
  window.open(`${DIRECTORY_URL}/${section}${orgId ? `?org=${encodeURIComponent(orgId)}` : ""}`, "_blank", "noopener");
}
