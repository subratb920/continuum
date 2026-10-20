import { test } from "node:test";
import assert from "node:assert/strict";
import { APPS, FEATURES, FEATURE_IDS, childrenOf, effectiveFeatures, featuresOfApp, givenToEveryone } from "../src/features.js";
import { roleFeatures } from "../src/users.js";

test("features come app by app; an app's sub-features count only while the app is on", () => {
  assert.deepEqual(APPS.map((a) => a.id), ["console", "directory", "create", "workspaces", "agents", "data", "deploy"]);
  assert.deepEqual([...new Set(FEATURES.map((f) => f.app))].sort(), APPS.map((a) => a.id).sort());
  for (const f of FEATURES.filter((x) => x.parent)) assert.equal(FEATURES.find((x) => x.id === f.parent)?.app, f.app, `${f.id}'s parent opens its app`);
  assert.deepEqual(effectiveFeatures(["deploy_run", "data", "data_recipes", "nonsense"]), ["data", "data_recipes"], "deploy_run without deploy is off");
});

test("the Directory: everyone opens it once their role is upgraded; Admin is its admin area and only the admin role has it by default", () => {
  assert.deepEqual(givenToEveryone(3), ["directory"]);
  assert.deepEqual(givenToEveryone(4), []);
  assert.deepEqual(featuresOfApp("directory", FEATURE_IDS), ["directory", "admin"]);
  assert.deepEqual(roleFeatures({ id: "admin", features: [] }), FEATURE_IDS, "admin always has everything");
  assert.equal(roleFeatures({ id: "member", features: FEATURE_IDS.filter((f) => f !== "admin") }).includes("admin"), false);
  assert.deepEqual(childrenOf("agents", 2), [], "nothing under agents came after feature set 2");
});
