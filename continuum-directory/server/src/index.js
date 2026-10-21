import { createPool, migrate } from "./db/pool.js";
import { configProblems } from "./config.js";
import { createUsers } from "./users.js";
import { createActivity, networkOf } from "./activity.js";
import { createAdmin } from "./admin.js";
import { createOrgs } from "./orgs.js";
import { createLinks } from "./links.js";
import { importFromMongo } from "./importMongo.js";
import { createDirectoryRouter } from "./api/router.js";
import * as features from "./features.js";

export { directoryConfigFromEnv } from "./config.js";
export { DirectoryError } from "./errors.js";
export { ORG_ROLES, parseSpace, personalSpaceId, orgSpaceId } from "./orgs.js";
export { features };

/**
 * continuum-directory: Continuum's directory of users (humans, agents, apps,
 * orgs, departments), their roles and features, organizations and
 * departments, sign-ins and app use, on its own Postgres.
 *
 * The host gives it its settings, a logger and hooks, mounts
 * router({ auth }) at /directory, calls start() and stop(), and asks it
 * (api.*) who someone is and what they may use. It imports nothing from the
 * host, so a server of its own can host it the same way later.
 *
 * Hooks (all optional):
 *   continuumUser(id)   → { email, createdAt, github? } a Continuum account not
 *                          in the directory yet (it's added as a human)
 *   endSessions(userId) → the host's own sessions ended (sign out everywhere)
 *   countProjects({ userId? , spaceId?, departmentId? }) → how many projects
 *   legacyMongo()       → Continuum's MongoDB, read once to fill an empty directory
 */
export function createDirectory(cfg, { log, hooks = {} } = {}) {
  const pool = createPool(cfg);
  const users = createUsers({ pool, cfg, hooks, log });
  const activity = createActivity({ pool, cfg });
  const orgs = createOrgs({ pool, hooks });
  const links = createLinks({ pool });
  const admin = createAdmin({ pool, users, hooks });
  const usage = activity.createUsageTracker();
  let sweeper = null;

  const directory = {
    cfg,
    log,
    pool,
    ready: false,
    parts: { users, activity, orgs, links, admin },
    usage,

    /** What the host asks of the directory. */
    api: {
      features,
      accessFor: users.accessFor,
      clearAccessCache: users.clearAccessCache,
      registerHuman: users.registerHuman,
      linkGithub: users.linkGithub,
      ensureOwners: users.ensureOwners,
      sessionVersion: users.sessionVersion,
      signOutEverywhere: users.signOutEverywhere,
      adminSetupOpen: users.adminSetupOpen,
      prepareAdminSetup: users.prepareAdminSetup,
      recordLogin: activity.recordLogin,
      recordVisit: activity.recordVisit,
      networkOf, // build a network summary from a request (for the public visit beacon)
      attachClient: activity.attachClient,
      exportUsage: activity.exportUsage,
      importUsage: activity.importUsage,
      used: usage.used,
      sawUser: usage.sawUser,
      resolveSpace: orgs.resolveSpace,
      spacesFor: orgs.spacesFor,
      cleanDepartments: orgs.cleanDepartments,
      link: links.link,
      userFor: links.userFor,
    },

    router: ({ auth }) => createDirectoryRouter({ directory, auth }),

    async start() {
      const missing = configProblems(cfg);
      if (missing.length) throw new Error(`continuum-directory needs these settings: ${missing.join(", ")}`);
      await migrate(pool, log);
      if (hooks.legacyMongo) {
        const mongo = await hooks.legacyMongo();
        if (mongo) await importFromMongo({ pool, mongo, log });
      }
      await users.ensureBuiltIns();
      if (await users.ensureOwners()) log?.info?.("Directory: owner account made admin");
      // Sign-ins and app use past their days go, hourly
      const sweep = () => activity.sweep().catch((err) => log?.warn?.({ err: err.message }, "Directory sweep failed"));
      sweeper = setInterval(sweep, 3_600_000);
      sweeper.unref?.();
      sweep();
      directory.ready = true;
      log?.info?.("continuum-directory started");
    },

    async stop() {
      directory.ready = false;
      clearInterval(sweeper);
      await usage.flush().catch(() => {});
      await pool.end();
    },
  };
  return directory;
}
