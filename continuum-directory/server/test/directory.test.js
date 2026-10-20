import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createDirectory, directoryConfigFromEnv } from "../src/index.js";
import { newId } from "../src/ids.js";

/**
 * The directory against a real Postgres: PG_TEST_URL names a throwaway
 * database (its tables are dropped first). Skipped without it.
 */
const url = process.env.PG_TEST_URL;
const skip = !url ? "PG_TEST_URL not set" : false;

/** Just enough of a MongoDB to import from: collection(name).find() → toArray / for await. */
function fakeMongo(data) {
  const cursor = (rows) => ({ toArray: async () => rows, [Symbol.asyncIterator]: async function* () { yield* rows; } });
  return { collection: (name) => ({ find: () => cursor(data[name] ?? []), findOne: async (q) => (data[name] ?? []).find((d) => d._id === q._id) ?? null }) };
}

const hex = () => newId();
const ids = { owner: hex(), ana: hex(), bo: hex(), cy: hex(), dee: hex(), old: hex() };
let directory;
let projects = []; // what countProjects counts

before(async () => {
  if (skip) return;
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await c.end();
  const ended = [];
  directory = createDirectory(
    { ...directoryConfigFromEnv({ DIRECTORY_DATABASE_URL: url }), accessCacheMs: 0 },
    {
      hooks: {
        continuumUser: async (id) => (id === ids.dee ? { email: "dee@x.test", createdAt: new Date() } : null),
        endSessions: async (id) => (ended.push(id), { deploySessions: 1 }),
        countProjects: async ({ userId, spaceId, departmentId }) =>
          projects.filter((p) => (!userId || p.userId === userId) && (!spaceId || p.spaceId === spaceId) && (!departmentId || p.departmentIds?.includes(departmentId))).length,
        legacyMongo: async () =>
          fakeMongo({
            roles: [
              { _id: "admin", name: "Admin", features: ["interval"], featureSet: 3, builtIn: true },
              { _id: "member", name: "Member", features: ["interval", "dashboard", "agents"], featureSet: 3, builtIn: true },
              { _id: "viewer-ish", name: "Viewer-ish", features: ["dashboard"], featureSet: 3 },
            ],
            settings: [{ _id: "access", defaultRoleId: "member" }],
            users: [
              { _id: ids.owner, email: "subratb920@gmail.com", githubId: 1, github: { login: "subrat", name: "Subrat" }, roleId: "admin", tokenVersion: 2, createdAt: new Date("2026-01-01") },
              { _id: ids.ana, email: "Ana@x.test", roleId: "viewer-ish", lastSeenAt: new Date("2026-10-01") },
              { _id: ids.bo, email: "bo@x.test" },
              { _id: ids.cy, email: "cy@x.test", disabled: true },
              { _id: ids.old, email: "old@x.test" },
            ],
            login_events: [{ userId: ids.ana, email: "ana@x.test", method: "email", ok: true, at: new Date(), ip: "203.0.113.7", expireAt: new Date(Date.now() + 86_400_000) }],
            app_usage: [{ _id: `${ids.ana}:agents:2026-10-17`, userId: ids.ana, app: "agents", day: "2026-10-17", count: 3, lastAt: new Date(), expireAt: new Date(Date.now() + 86_400_000) }],
            admin_audit: [{ type: "ADMIN_CLAIMED", by: ids.owner, at: new Date() }],
          }),
      },
    }
  );
  directory.ended = ended;
  await directory.start();
});

after(async () => {
  if (skip) return;
  await directory.stop();
});

test("the import from Continuum's MongoDB: once, add-only; humans keep their role, status and session version", { skip }, async () => {
  const { api, pool } = directory;
  const counts = (await pool.query(`SELECT value FROM settings WHERE key = 'mongo_import'`)).rows[0].value.counts;
  assert.equal(counts.users, 5);
  assert.equal(counts.loginEvents, 1);
  assert.equal(counts.appUsage, 1);
  const { importFromMongo } = await import("../src/importMongo.js");
  assert.equal((await importFromMongo({ pool, mongo: null })).skipped, true, "a second run adds nothing");

  const ana = await api.accessFor(ids.ana);
  assert.equal(ana.kind, "human");
  assert.equal(ana.email, "ana@x.test");
  assert.equal(ana.role.id, "viewer-ish");
  // Roles from an older feature set get Open Directory once
  assert.deepEqual(ana.features, ["dashboard", "directory"]);
  assert.equal((await api.accessFor(ids.cy)).disabled, true);
  // The owner keeps admin from the import
  const owner = await api.accessFor(ids.owner);
  assert.equal(owner.isAdmin, true);
  assert.equal(owner.tokenVersion, 2);
});

test("the owner is the owner's address verified by the linked GitHub account; a GitHub link alone isn't enough", { skip }, async () => {
  const { api, parts, pool } = directory;
  await pool.query(`UPDATE users SET role_id = 'member' WHERE id = $1`, [ids.owner]);
  // Linked, but GitHub never verified the address for it: not the owner
  await api.linkGithub(ids.owner, { id: 1, login: "subrat", name: "Subrat", verifiedEmails: ["someone-else@x.test"] });
  assert.equal(await parts.users.isOwner(ids.owner), false);
  assert.equal((await api.accessFor(ids.owner)).isAdmin, false);
  // GitHub has verified it: the owner, made admin
  await api.linkGithub(ids.owner, { id: 1, login: "subrat", name: "Subrat", verifiedEmails: ["SubratB920@gmail.com"] });
  assert.equal(await parts.users.isOwner(ids.owner), true);
  assert.equal((await api.accessFor(ids.owner)).isAdmin, true);
});

test("a Continuum account the directory doesn't know yet is added as a human with the default role", { skip }, async () => {
  const dee = await directory.api.accessFor(ids.dee);
  assert.equal(dee.kind, "human");
  assert.equal(dee.role.id, "member");
  assert.ok(dee.features.includes("directory"));
  assert.equal(dee.isAdmin, false);
  assert.equal(await directory.api.accessFor(hex()), null, "no such account anywhere");
});

test("signing out everywhere raises the session version and ends the host's sessions", { skip }, async () => {
  const before = await directory.api.sessionVersion(ids.bo);
  const r = await directory.api.signOutEverywhere(ids.bo);
  assert.equal(await directory.api.sessionVersion(ids.bo), before + 1);
  assert.deepEqual(r, { deploySessions: 1 });
  assert.ok(directory.ended.includes(ids.bo));
});

test("sign-ins, the browser's details, app use and the admin's view of users", { skip }, async () => {
  const { api, parts } = directory;
  const req = { ip: "198.51.100.9", get: (h) => ({ "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Chrome/126.0.0.0 Safari/537.36" })[h.toLowerCase()] ?? null };
  await api.recordLogin({ userId: ids.bo, email: "bo@x.test", method: "email", req });
  assert.equal(await api.attachClient(ids.bo, { timezone: "Asia/Kolkata", cores: 8, junk: { x: 1 } }), true);
  api.used(ids.bo, "agents");
  api.used(ids.bo, "agents");
  api.sawUser(ids.bo);
  await directory.usage.flush();

  const list = await parts.admin.listUsers({ search: "bo@" });
  assert.equal(list.total, 1);
  const bo = list.users[0];
  assert.equal(bo.kind, "human");
  assert.equal(bo.signsInWith, "email");
  assert.equal(bo.lastDevice.browser, "Chrome 126.0");
  assert.equal(bo.lastDevice.client.timezone, "Asia/Kolkata");
  assert.deepEqual(bo.apps.map((a) => [a.app, a.count]), [["agents", 2]]);
  const one = await parts.admin.getUser(ids.bo);
  assert.equal(one.logins[0].client.cores, 8);
  assert.deepEqual(one.links.map((l) => l.system), ["continuum"]);
  const owner = (await parts.admin.listUsers({ search: "subrat" })).users[0];
  assert.equal(owner.owner, true);
  assert.equal(owner.github.login, "subrat");
});

test("roles: admin keeps everything; the last admin and the owner stay admins; a deleted role's users move", { skip }, async () => {
  const { admin, users } = directory.parts;
  const role = await admin.createRole({ name: "Support", features: ["dashboard", "agents", "agents_run"] });
  assert.deepEqual(role.features, ["dashboard", "agents", "agents_run"]);
  await assert.rejects(admin.createRole({ name: "support" }), { code: "ROLE_EXISTS" });
  await assert.rejects(admin.updateRole("admin", { features: [] }), { code: "ADMIN_LOCKED" });
  await admin.updateUser(ids.owner, ids.bo, { roleId: role.id });
  assert.equal((await directory.api.accessFor(ids.bo)).role.id, role.id);
  await assert.rejects(admin.updateUser(ids.bo, ids.owner, { roleId: "member" }), { code: "OWNER" });
  await assert.rejects(admin.updateUser(ids.owner, ids.owner, { disabled: true }), { code: "OWNER" });
  const r = await admin.deleteRole(role.id);
  assert.equal(r.moved, 1);
  assert.equal((await directory.api.accessFor(ids.bo)).role.id, "member");
  assert.equal(await users.countAdmins(), 1);
});

test("organizations: invites, departments, spaces; an organization's admin is not Continuum's admin", { skip }, async () => {
  const { orgs } = directory.parts;
  const org = await orgs.createOrg(ids.owner, "Acme");
  const eng = await orgs.addDepartment(org.orgId, ids.owner, "Engineering");
  const sales = await orgs.addDepartment(org.orgId, ids.owner, "Sales");
  await assert.rejects(orgs.addDepartment(org.orgId, ids.owner, "engineering"), { code: "DEPARTMENT_EXISTS" });

  // The organization and its departments are users too
  const kinds = (await directory.pool.query(`SELECT kind FROM users WHERE id = ANY($1) ORDER BY kind`, [[org.orgId, eng.id, sales.id]])).rows.map((r) => r.kind);
  assert.deepEqual(kinds, ["department", "department", "org"]);

  await orgs.invite(org.orgId, ids.owner, { email: "ANA@x.test", orgRole: "admin" });
  await orgs.invite(org.orgId, ids.owner, { email: "bo@x.test", orgRole: "member", departmentIds: [eng.id] });
  for (const k of ["ana", "bo"]) {
    const inv = (await orgs.spacesFor(ids[k])).invites[0];
    assert.equal(inv.orgName, "Acme");
    await orgs.acceptInvite(ids[k], inv.id);
  }
  await assert.rejects(orgs.acceptInvite(ids.cy, hex()), { code: "NOT_FOUND" });

  const bo = await orgs.resolveSpace(ids.bo, org.id);
  assert.deepEqual([bo.kind, bo.orgRole, bo.departmentIds], ["org", "member", [eng.id]]);
  await assert.rejects(orgs.resolveSpace(ids.cy, org.id), { code: "NOT_IN_SPACE" });
  await assert.rejects(orgs.resolveSpace(ids.cy, `u:${ids.bo}`), { code: "NOT_IN_SPACE" });

  // An organization's admin is not Continuum's admin
  assert.equal((await directory.api.accessFor(ids.ana)).isAdmin, false);
  await assert.rejects(orgs.invite(org.orgId, ids.ana, { email: "x@x.test", orgRole: "owner" }), { code: "NOT_ORG_OWNER" });
  await assert.rejects(orgs.updateMember(org.orgId, ids.ana, ids.bo, { orgRole: "owner" }), { code: "NOT_ORG_OWNER" });
  await assert.rejects(orgs.updateMember(org.orgId, ids.owner, ids.owner, { orgRole: "admin" }), { code: "LAST_OWNER" });
  await orgs.updateMember(org.orgId, ids.ana, ids.bo, { departmentIds: [sales.id] });
  assert.deepEqual((await orgs.resolveSpace(ids.bo, org.id)).departmentIds, [sales.id]);

  // Departments and the organization go only while no project is in them
  projects = [{ userId: ids.bo, spaceId: org.id, departmentIds: [sales.id] }];
  await assert.rejects(orgs.deleteDepartment(org.orgId, ids.owner, sales.id), { code: "DEPARTMENT_IN_USE" });
  await assert.rejects(orgs.deleteOrg(org.orgId, ids.owner), { code: "ORG_HAS_PROJECTS" });
  projects = [];
  await orgs.deleteDepartment(org.orgId, ids.owner, eng.id);
  assert.deepEqual((await orgs.getOrg(org.orgId, ids.bo)).departments.map((d) => d.name), ["Sales"]);

  // The space last used; leaving; deleting
  await orgs.setLastSpace(ids.bo, org.id);
  assert.equal((await orgs.spacesFor(ids.bo)).lastSpaceId, org.id);
  await orgs.removeMember(org.orgId, ids.bo, ids.bo);
  assert.equal((await orgs.spacesFor(ids.bo)).lastSpaceId, `u:${ids.bo}`);
  await assert.rejects(orgs.deleteOrg(org.orgId, ids.ana), { code: "NOT_ORG_OWNER" });
  await orgs.deleteOrg(org.orgId, ids.owner);
  assert.equal((await directory.pool.query(`SELECT count(*)::int AS n FROM users WHERE kind IN ('org', 'department')`)).rows[0].n, 0);
});

test("mappings: who a system's id is", { skip }, async () => {
  const { api } = directory;
  await api.link(ids.ana, "deploy", `u:${ids.ana}`);
  assert.equal(await api.userFor("deploy", `u:${ids.ana}`), ids.ana);
  assert.equal(await api.userFor("github", "1"), ids.owner);
  await assert.rejects(api.link(ids.ana, "Not A System", "x"), { code: "VALIDATION_ERROR" });
});

test("the first admin claims it with the setup code, only while there's none", { skip }, async () => {
  const { api, parts } = directory;
  assert.equal(await api.prepareAdminSetup(), null, "there's an admin (the owner)");
  await directory.pool.query(`UPDATE users SET role_id = 'member' WHERE id = $1`, [ids.owner]);
  await directory.pool.query(`DELETE FROM links WHERE system = 'github'`); // not the owner any more
  const setup = await api.prepareAdminSetup();
  assert.match(setup.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(await api.adminSetupOpen(), true);
  assert.equal(await parts.users.claimAdmin(ids.ana, "WRONG-CODE-XXXX"), false);
  assert.equal(await parts.users.claimAdmin(ids.ana, setup.code.toLowerCase()), true);
  assert.equal(await parts.users.claimAdmin(ids.bo, setup.code), false, "used once");
  assert.equal((await api.accessFor(ids.ana)).isAdmin, true);
});
