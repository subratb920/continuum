// continuum-directory/server/src/users.js
//
// Users and what they may use. Every identity is a user (kind human, agent,
// app, org or department); a human has one Continuum role (users.role_id), a
// role is a set of features switched on. Built in: admin (everything, always)
// and member (everything but admin). A human with no role is a member; a new
// one gets the default role (settings "access").
//
// Admins are only ever users whose role is admin, here: nothing else (no
// setting, no cloud, no organization role) says who they are. The owner
// (OWNER_EMAILS) is always one: their account's address must be one GitHub
// has verified for the GitHub account linked to it (an email sign-up isn't
// verified, so it never makes an owner). Without any admin, the first one claims it with a one-time setup
// code written to the host's log (claimAdmin); after that, admins make admins.
//
// Sessions: each user has a session version (token_version); every sign-in
// token carries it (tv). Signing someone out everywhere raises it, so every
// token made before stops working at once; the host also ends its own
// sessions then (hooks.endSessions).
//
// A user's access is cached per API copy (accessCacheMs), cleared at once in
// the copy that changes it.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { FEATURE_IDS, FEATURE_SET, childrenOf, effectiveFeatures, givenToEveryone } from "./features.js";
import { badRequest } from "./errors.js";
import { isId } from "./ids.js";

export const ADMIN_ROLE = "admin";
export const MEMBER_ROLE = "member";

const BUILT_IN = [
  { id: ADMIN_ROLE, name: "Admin", description: "Everything, including the admin area.", features: FEATURE_IDS },
  { id: MEMBER_ROLE, name: "Member", description: "Everything except the admin area.", features: FEATURE_IDS.filter((f) => f !== "admin") },
];

/** Continuum's owner: always an admin, through a GitHub-linked account (a verified address) only. */
export const OWNER_EMAILS = ["subratb920@gmail.com"];
export const isOwnerEmail = (email) => OWNER_EMAILS.includes(String(email ?? "").trim().toLowerCase());

const SETUP_HOURS = 24;
const hashCode = (code) => createHash("sha256").update(String(code).replace(/[^A-Z0-9]/gi, "").toUpperCase()).digest();

/** A role's features: only known ones, each app's sub-features only with the app on; admin always has them all. */
export function roleFeatures(role) {
  if (role?.id === ADMIN_ROLE) return [...FEATURE_IDS];
  return effectiveFeatures(role?.features ?? []);
}

export function createUsers({ pool, cfg, hooks = {}, log }) {
  const q = (sql, params) => pool.query(sql, params);
  const cache = new Map(); // userId → { at, access }

  /** The built-in roles and the access settings (safe on every start); roles from an older feature set gain what's new, once. */
  async function ensureBuiltIns() {
    for (const r of BUILT_IN) {
      await q(
        `INSERT INTO roles (id, name, description, features, feature_set, built_in) VALUES ($1, $2, $3, $4, $5, true) ON CONFLICT (id) DO NOTHING`,
        [r.id, r.name, r.description, r.features, FEATURE_SET]
      );
    }
    const { rows } = await q(`SELECT id, features, feature_set FROM roles WHERE feature_set <> $1`, [FEATURE_SET]);
    for (const r of rows) {
      const before = r.feature_set || 1;
      const features = [...new Set([...r.features, ...r.features.flatMap((f) => childrenOf(f, before)), ...givenToEveryone(before)])];
      await q(`UPDATE roles SET features = $2, feature_set = $3, updated_at = now() WHERE id = $1 AND feature_set = $4`, [r.id, features, FEATURE_SET, r.feature_set]);
    }
    await q(`INSERT INTO settings (key, value) VALUES ('access', $1) ON CONFLICT (key) DO NOTHING`, [{ defaultRoleId: MEMBER_ROLE }]);
  }

  async function accessSettings() {
    return (await q(`SELECT value FROM settings WHERE key = 'access'`)).rows[0]?.value ?? { defaultRoleId: MEMBER_ROLE };
  }

  /** The role a new human gets (the default role, if it still exists). */
  async function roleForNewUser() {
    const id = (await accessSettings()).defaultRoleId ?? MEMBER_ROLE;
    return (await q(`SELECT 1 FROM roles WHERE id = $1`, [id])).rowCount ? id : MEMBER_ROLE;
  }

  /**
   * A human (a Continuum account) in the directory: added the first time with
   * the default role and a link to their account; known already: nothing changes.
   */
  async function registerHuman({ id, email = null, displayName = null, createdAt = null }) {
    if (!isId(id)) throw badRequest("That isn't a user id.", "BAD_ID");
    const role = await roleForNewUser();
    const r = await q(
      `INSERT INTO users (id, kind, email, display_name, role_id, created_at) VALUES ($1, 'human', $2, $3, $4, COALESCE($5, now()))
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [id, email ? String(email).toLowerCase() : null, displayName, role, createdAt]
    );
    await q(`INSERT INTO links (user_id, system, external_id) VALUES ($1, 'continuum', $1) ON CONFLICT DO NOTHING`, [id]);
    if (r.rowCount) log?.info?.({ userId: id }, "Directory: human added");
    return r.rowCount === 1;
  }

  /** The directory's row for this user; a Continuum account not here yet is added (hooks.continuumUser). */
  async function userRow(userId) {
    const id = String(userId);
    if (!isId(id)) return null;
    let u = (await q(`SELECT * FROM users WHERE id = $1`, [id])).rows[0];
    if (!u && hooks.continuumUser) {
      const acct = await hooks.continuumUser(id);
      if (!acct) return null;
      await registerHuman({ id, email: acct.email, displayName: acct.github?.name ?? acct.github?.login ?? null, createdAt: acct.createdAt });
      if (acct.github?.id) await linkGithub(id, acct.github);
      u = (await q(`SELECT * FROM users WHERE id = $1`, [id])).rows[0];
    }
    return u ?? null;
  }

  /**
   * Signed in with (or connected) GitHub: the mapping, their name, and the
   * addresses GitHub has verified for that account (github.verifiedEmails);
   * the owner becomes an admin.
   */
  async function linkGithub(userId, github) {
    if (!github?.id) return;
    const details = {
      login: github.login ?? null,
      name: github.name ?? null,
      avatarUrl: github.avatarUrl ?? null,
      verifiedEmails: (github.verifiedEmails ?? []).map((e) => String(e).toLowerCase()),
    };
    await q(
      `INSERT INTO links (user_id, system, external_id, details) VALUES ($1, 'github', $2, $3)
       ON CONFLICT (system, external_id) DO UPDATE SET user_id = EXCLUDED.user_id, details = EXCLUDED.details, updated_at = now()`,
      [String(userId), String(github.id), details]
    );
    await q(`UPDATE users SET display_name = COALESCE(display_name, $2), updated_at = now() WHERE id = $1`, [String(userId), github.name ?? github.login ?? null]);
    await ensureOwners();
  }

  /**
   * The owner's account (its address verified by the GitHub account linked to
   * it) is an admin, enabled: on every start and at each GitHub sign-in.
   * Returns how many changed.
   */
  async function ensureOwners() {
    const r = await q(
      `UPDATE users u SET role_id = $1, disabled = false, updated_at = now()
       WHERE u.kind = 'human' AND lower(u.email) = ANY($2) AND (u.role_id IS DISTINCT FROM $1 OR u.disabled)
         AND EXISTS (SELECT 1 FROM links l WHERE l.user_id = u.id AND l.system = 'github' AND l.details->'verifiedEmails' ? lower(u.email))
       RETURNING id`,
      [ADMIN_ROLE, OWNER_EMAILS]
    );
    if (r.rowCount) clearAccessCache();
    return r.rowCount;
  }

  /** Is this user the owner (the owner's address, verified by their linked GitHub account)? */
  async function isOwner(userId) {
    const r = await q(
      `SELECT 1 FROM users u WHERE u.id = $1 AND lower(u.email) = ANY($2) AND EXISTS (SELECT 1 FROM links l WHERE l.user_id = u.id AND l.system = 'github' AND l.details->'verifiedEmails' ? lower(u.email))`,
      [String(userId), OWNER_EMAILS]
    );
    return r.rowCount > 0;
  }

  /** Admins who can sign in (admin role, not disabled). */
  async function countAdmins() {
    return (await q(`SELECT count(*)::int AS n FROM users WHERE kind = 'human' AND role_id = $1 AND NOT disabled`, [ADMIN_ROLE])).rows[0].n;
  }

  /**
   * While there's no admin: a one-time setup code (24 hours), returned for the
   * host's own log only. A code still valid is kept ({ existing: true }); with
   * an admin: none, and any old code is gone. Run on every start.
   */
  async function prepareAdminSetup({ now = new Date() } = {}) {
    const s = await accessSettings();
    if ((await countAdmins()) > 0) {
      if (s.adminSetup) await q(`UPDATE settings SET value = value - 'adminSetup', updated_at = now() WHERE key = 'access'`);
      return null;
    }
    if (s.adminSetup && new Date(s.adminSetup.expiresAt) > now) return { existing: true, expiresAt: new Date(s.adminSetup.expiresAt) };
    const raw = randomBytes(10).toString("base64url").replace(/[^A-Za-z0-9]/g, "").toUpperCase().padEnd(12, "X").slice(0, 12);
    const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
    const expiresAt = new Date(now.getTime() + SETUP_HOURS * 3_600_000);
    await q(`UPDATE settings SET value = jsonb_set(value, '{adminSetup}', $1), updated_at = now() WHERE key = 'access'`, [{ codeHash: hashCode(code).toString("hex"), expiresAt }]);
    return { code, expiresAt };
  }

  /** Is there no admin yet, with a setup code waiting? */
  async function adminSetupOpen({ now = new Date() } = {}) {
    const s = await accessSettings();
    if (!s.adminSetup || new Date(s.adminSetup.expiresAt) <= now) return false;
    return (await countAdmins()) === 0;
  }

  /** The first admin: a signed-in human with the setup code becomes admin, once, only while there's no admin. */
  async function claimAdmin(userId, code, { now = new Date() } = {}) {
    const s = await accessSettings();
    if (!s.adminSetup || new Date(s.adminSetup.expiresAt) <= now || (await countAdmins()) > 0) return false;
    const want = Buffer.from(s.adminSetup.codeHash, "hex");
    const got = hashCode(code ?? "");
    if (want.length !== got.length || !timingSafeEqual(want, got)) return false;
    // Used once: the code goes before the role is given (two claims at once: one wins)
    const taken = await q(`UPDATE settings SET value = value - 'adminSetup', updated_at = now() WHERE key = 'access' AND value->'adminSetup'->>'codeHash' = $1`, [s.adminSetup.codeHash]);
    if (taken.rowCount !== 1) return false;
    if (!(await userRow(userId))) return false;
    await q(`UPDATE users SET role_id = $2, updated_at = now() WHERE id = $1`, [String(userId), ADMIN_ROLE]);
    clearAccessCache(userId);
    return true;
  }

  /** A user's session version: what their sign-in tokens must carry (tv). */
  async function sessionVersion(userId) {
    return (await userRow(userId))?.token_version ?? 0;
  }

  /**
   * A user's access now: { userId, kind, email, disabled, role: { id, name },
   * features, isAdmin, tokenVersion }, or null when there's no such user.
   */
  async function accessFor(userId, { now = Date.now() } = {}) {
    const key = String(userId);
    const hit = cache.get(key);
    if (hit && now - hit.at < cfg.accessCacheMs) return hit.access;
    const u = await userRow(key);
    if (!u) return null;
    const roles = (await q(`SELECT * FROM roles WHERE id = ANY($1)`, [[u.role_id ?? MEMBER_ROLE, MEMBER_ROLE]])).rows;
    const role = roles.find((r) => r.id === (u.role_id ?? MEMBER_ROLE)) ?? roles.find((r) => r.id === MEMBER_ROLE) ?? BUILT_IN[1];
    const features = u.kind === "human" ? roleFeatures(role) : [];
    const access = {
      userId: key,
      kind: u.kind,
      email: u.email ?? null,
      disabled: !!u.disabled,
      role: { id: role.id, name: role.name },
      features,
      isAdmin: features.includes("admin"),
      tokenVersion: u.token_version ?? 0,
    };
    cache.set(key, { at: now, access });
    return access;
  }

  /** Forget cached access (one user, or everyone): after a role or user changes. */
  function clearAccessCache(userId) {
    if (userId === undefined) cache.clear();
    else cache.delete(String(userId));
  }

  /**
   * Signs a user out everywhere: every sign-in token made before stops working
   * (session version up), and the host ends its own sessions (Continuum's kept
   * sessions, Continuum Deploy's and the Directory's).
   */
  async function signOutEverywhere(userId) {
    await q(`UPDATE users SET token_version = token_version + 1, updated_at = now() WHERE id = $1`, [String(userId)]);
    clearAccessCache(userId);
    return (await hooks.endSessions?.(String(userId))) ?? {};
  }

  return {
    ensureBuiltIns,
    roleForNewUser,
    registerHuman,
    userRow,
    linkGithub,
    ensureOwners,
    isOwner,
    countAdmins,
    prepareAdminSetup,
    adminSetupOpen,
    claimAdmin,
    sessionVersion,
    accessFor,
    clearAccessCache,
    signOutEverywhere,
  };
}
