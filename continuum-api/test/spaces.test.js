import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { MongoClient, ObjectId } from "mongodb";

/**
 * Spaces in the API: which projects you see and may change, one active
 * project per space. Membership and departments come from the real directory
 * (continuum-directory). The filters are tested on their own; the rest needs
 * a throwaway MongoDB (MONGO_TEST_URL) and Postgres (PG_TEST_URL), both
 * emptied first. Skipped without them.
 */
const mongoUrl = process.env.MONGO_TEST_URL;
const pgUrl = process.env.PG_TEST_URL;
const skip = !mongoUrl || !pgUrl ? "MONGO_TEST_URL and PG_TEST_URL not set" : false;

Object.assign(process.env, {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  PORT: "0",
  MONGO_URI: mongoUrl || "mongodb://x",
  DB_NAME: "spaces_test",
  JWT_SECRET: "s".repeat(32),
  CLIENT_ORIGIN: "http://x",
  DIRECTORY_DATABASE_URL: pgUrl || "",
  DIRECTORY_ACCESS_CACHE_MS: "1",
});
const { projectFilter, personalProjectFilter, canWrite, managesOrg, canManageProject } = await import("../src/spaces/projectAccess.js");

const me = new ObjectId();

test("personal space: your projects, including those from before spaces; never an organization's", () => {
  const f = personalProjectFilter(me);
  assert.ok(f.userId.equals(me));
  assert.deepEqual(f.$or, [{ spaceId: `u:${me}` }, { spaceId: { $exists: false } }, { spaceId: null }]);
  assert.deepEqual(projectFilter({ kind: "user", id: `u:${me}` }, me), f);
});

test("an organization: owners and admins see every project; members and viewers their departments', those in none, and their own", () => {
  const d = "a".repeat(24);
  assert.deepEqual(projectFilter({ kind: "org", id: "o:x", orgRole: "owner" }, me), { spaceId: "o:x" });
  assert.deepEqual(projectFilter({ kind: "org", id: "o:x", orgRole: "admin" }, me), { spaceId: "o:x" });
  const f = projectFilter({ kind: "org", id: "o:x", orgRole: "member", departmentIds: [d] }, me);
  assert.equal(f.spaceId, "o:x");
  assert.deepEqual(f.$or.slice(0, 3), [{ departmentIds: { $in: [d] } }, { departmentIds: { $exists: false } }, { departmentIds: { $size: 0 } }]);
  assert.ok(f.$or[3].userId.equals(me));
});

test("a viewer only looks; managing a project is its adder's or the organization's owners' and admins'", () => {
  const viewer = { kind: "org", orgRole: "viewer" };
  const member = { kind: "org", orgRole: "member" };
  const admin = { kind: "org", orgRole: "admin" };
  assert.equal(canWrite(viewer), false);
  assert.equal(canWrite(member), true);
  assert.equal(canWrite({ kind: "user" }), true);
  assert.equal(managesOrg(member), false);
  assert.equal(managesOrg(admin), true);
  assert.equal(canManageProject(member, { userId: new ObjectId() }, me), false);
  assert.equal(canManageProject(member, { userId: me }, me), true);
  assert.equal(canManageProject(admin, { userId: new ObjectId() }, me), true);
  assert.equal(canManageProject(viewer, { userId: me }, me), false);
});

let client, db, directory, dir, closeDB;
const u = {};

before(async () => {
  if (skip) return;
  client = await MongoClient.connect(mongoUrl);
  db = client.db("spaces_test");
  await db.dropDatabase();
  for (const k of ["owner", "admin", "member", "viewer", "outsider"]) {
    u[k] = (await db.collection("users").insertOne({ email: `${k}@x.test`, createdAt: new Date() })).insertedId;
    await db.collection("execution_state").insertOne({ userId: u[k], activeProjectId: null });
  }
  const conn = await import("../src/config/db.js");
  await conn.connectToDB();
  closeDB = conn.closeDB;
  ({ directory, dir } = await import("../src/directory/directory.js"));
  await directory.pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await directory.start(); // fills itself from the MongoDB above (five humans)
});

after(async () => {
  if (skip) return;
  await directory.stop();
  await closeDB();
  await db.dropDatabase();
  await client.close();
});

test("an organization end to end: who sees which project, who may change it, one active project per space", { skip }, async () => {
  const { createProjectService } = await import("../src/services/project.service.js");
  const { createExecutionService } = await import("../src/services/execution.service.js");
  const { orgs } = directory.parts;
  const projects = await createProjectService(db);
  const exec = createExecutionService(db);

  const org = await orgs.createOrg(String(u.owner), "Acme");
  const eng = await orgs.addDepartment(org.orgId, String(u.owner), "Engineering");
  const sales = await orgs.addDepartment(org.orgId, String(u.owner), "Sales");
  for (const [k, orgRole, departmentIds] of [["admin", "admin", []], ["member", "member", [eng.id]], ["viewer", "viewer", [sales.id]]]) {
    const inv = await orgs.invite(org.orgId, String(u.owner), { email: `${k}@x.test`, orgRole, departmentIds });
    await orgs.acceptInvite(String(u[k]), inv.id);
  }
  const space = (k) => dir.resolveSpace(String(u[k]), org.id);

  // An organization's admin is not Continuum's admin
  assert.equal((await dir.accessFor(String(u.admin))).isAdmin, false);

  const pEng = await projects.createProject(u.owner, "api", { departmentIds: [eng.id] }, await space("owner"));
  const pSales = await projects.createProject(u.admin, "crm", { departmentIds: [sales.id] }, await space("admin"));
  const pAll = await projects.createProject(u.member, "handbook", {}, await space("member"));
  const pMine = await projects.createProject(u.member, "notes", {});
  await assert.rejects(projects.createProject(u.member, "x", { departmentIds: [sales.id] }, await space("member")), { code: "NOT_YOUR_DEPARTMENT" });
  await assert.rejects(projects.createProject(u.viewer, "x", {}, await space("viewer")), { code: "READ_ONLY" });

  const names = async (k, s) => (await projects.listProjects(u[k], s)).map((p) => p.name).sort();
  assert.deepEqual(await names("owner", await space("owner")), ["api", "crm", "handbook"]);
  assert.deepEqual(await names("member", await space("member")), ["api", "handbook"]);
  assert.deepEqual(await names("viewer", await space("viewer")), ["crm", "handbook"]);
  assert.deepEqual(await names("member"), ["notes"], "personal: only your own, never the organization's");
  assert.deepEqual(await names("owner"), [], "the projects you added to an organization aren't personal");

  await assert.rejects(projects.renameProject(u.member, pEng, "api2", await space("member")), { code: "NOT_YOURS" });
  await projects.renameProject(u.member, pAll, "Handbook 2", await space("member"));
  await assert.rejects(projects.renameProject(u.viewer, pSales, "y", await space("viewer")), { code: "READ_ONLY" });
  await assert.rejects(projects.renameProject(u.member, pSales, "y", await space("member")), { code: "PROJECT_NOT_FOUND" });

  // The directory counts the organization's projects (they stay here)
  await assert.rejects(orgs.deleteDepartment(org.orgId, String(u.owner), sales.id), { code: "DEPARTMENT_IN_USE" });
  assert.equal((await orgs.getOrg(org.orgId, String(u.owner))).projects, 3);

  // One active project per person per space
  await exec.activateProject(u.member, String(pMine));
  await exec.activateProject(u.member, String(pAll), await space("member"));
  assert.equal((await exec.getActiveProject(u.member)).name, "notes");
  assert.equal((await exec.getActiveProject(u.member, await space("member"))).name, "Handbook 2");
  await assert.rejects(exec.activateProject(u.member, String(pMine), await space("member")), { code: "PROJECT_NOT_FOUND" });
  await exec.activateProject(u.viewer, String(pAll), await space("viewer"));
  await assert.rejects(exec.assertCanStartBridge(u.viewer, String(pAll), await space("viewer")), { code: "READ_ONLY" });
  await exec.assertCanStartBridge(u.member, String(pAll), await space("member"));

  await projects.deleteProject(u.owner, pAll, await space("owner"));
  assert.equal(await exec.getActiveProject(u.member, await space("member")), null);
  assert.equal((await exec.getActiveProject(u.member)).name, "notes");
});
