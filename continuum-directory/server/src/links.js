// continuum-directory/server/src/links.js
//
// Mappings: a user (of any kind) as other systems know it — the Continuum
// account, GitHub, Continuum Deploy's tenant, continuum-brain's key or agent.

import { badRequest } from "./errors.js";

const SYSTEM = /^[a-z][a-z0-9-]{1,31}$/;

export function createLinks({ pool }) {
  const q = (sql, params) => pool.query(sql, params);

  /** Records (or moves) a mapping: this user is externalId in system. */
  async function link(userId, system, externalId, details = null) {
    if (!SYSTEM.test(String(system))) throw badRequest("That isn't a system name.");
    if (!externalId || String(externalId).length > 200) throw badRequest("That isn't an id.");
    await q(
      `INSERT INTO links (user_id, system, external_id, details) VALUES ($1, $2, $3, $4)
       ON CONFLICT (system, external_id) DO UPDATE SET user_id = EXCLUDED.user_id, details = COALESCE(EXCLUDED.details, links.details), updated_at = now()`,
      [String(userId), system, String(externalId), details]
    );
  }

  /** Who is externalId in system (null if nobody). */
  async function userFor(system, externalId) {
    return (await q(`SELECT user_id FROM links WHERE system = $1 AND external_id = $2`, [system, String(externalId)])).rows[0]?.user_id ?? null;
  }

  /** A user's mappings: { system: [{ externalId, details }] }. */
  async function linksOf(userId) {
    const out = {};
    for (const r of (await q(`SELECT system, external_id, details FROM links WHERE user_id = $1 ORDER BY system, created_at`, [String(userId)])).rows) {
      (out[r.system] ??= []).push({ externalId: r.external_id, details: r.details ?? null });
    }
    return out;
  }

  return { link, userFor, linksOf };
}
