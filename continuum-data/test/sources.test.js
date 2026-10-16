import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestEngine, waitFor } from "./helpers.js";
import { openml } from "../src/catalogue/openml.js";
import { uci } from "../src/catalogue/uci.js";
import { kaggle } from "../src/catalogue/kaggle.js";
import { urlConnector } from "../src/catalogue/url.js";
import { licenceId } from "../src/catalogue/http.js";
import { seal, open } from "../src/credentials.js";

/** A fetch that answers from a table of URL prefixes (recorded API shapes). */
function fakeFetch(routes, seen = []) {
  return async (url, init = {}) => {
    seen.push({ url, headers: init.headers ?? {} });
    const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    if (!hit) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(hit[1]), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

test("OpenML: search, describe and a Parquet download with the target as label", async () => {
  const o = openml({
    fetchImpl: fakeFetch({
      "https://www.openml.org/api/v1/json/data/list/data_name/iris": { data: { dataset: [{ did: 61, name: "iris", version: 1, quality: [{ name: "NumberOfInstances", value: "150.0" }] }, { did: 969, name: "iris", version: 3 }] } },
      "https://www.openml.org/api/v1/json/data/61": { data_set_description: { id: "61", name: "iris", licence: "Public", default_target_attribute: "class", parquet_url: "http://openml1.win.tue.nl/datasets/0000/0061/dataset_61.pq", file_id: "61" } },
    }),
  });
  const found = await o.search({ q: "Iris" });
  assert.equal(found.length, 1, "one entry per name");
  assert.equal(found[0].size.rows, 150);
  const plan = await o.fetchPlan("61");
  assert.equal(plan.files[0].url, "https://openml1.win.tue.nl/datasets/0000/0061/dataset_61.pq");
  assert.equal(plan.labelColumn, "class");
  assert.deepEqual(await o.search({ q: "iris", modality: "image" }), []);
  await assert.rejects(o.describe("../x"), /a number/);
});

test("UCI: the CSV when there is one, the zip otherwise; CC BY 4.0", async () => {
  const u = uci({
    fetchImpl: fakeFetch({
      "https://archive.ics.uci.edu/api/dataset?id=53": { data: { uci_id: 53, name: "Iris", abstract: "Flowers", data_url: "https://archive.ics.uci.edu/static/public/53/data.csv", target_col: ["class"], num_instances: 150, tasks: "Classification" } },
      "https://archive.ics.uci.edu/api/dataset?id=2": { data: { uci_id: 2, name: "Adult Income", tasks: "Classification" } },
    }),
  });
  const a = await u.fetchPlan("53");
  assert.equal(a.files[0].path, "53.csv");
  assert.equal(a.labelColumn, "class");
  assert.equal(a.extract, false);
  const b = await u.fetchPlan("2");
  assert.equal(b.files[0].url, "https://archive.ics.uci.edu/static/public/2/adult+income.zip");
  assert.equal(b.extract, true);
  assert.equal((await u.describe("53")).licence, "cc-by-4.0");
});

test("Kaggle: needs the token, sends it as Basic auth, downloads a zip", async () => {
  const seen = [];
  const k = kaggle({ fetchImpl: fakeFetch({ "https://www.kaggle.com/api/v1/datasets/list": [{ ref: "heptapod/titanic", title: "Titanic", licenseName: "CC0: Public Domain", totalBytes: 34877, downloadCount: 10 }] }, seen) });
  assert.deepEqual(await k.search({ q: "titanic" }), [], "no token, no search");
  const r = await k.search({ q: "titanic", token: "me:0123456789abcdef0123" });
  assert.equal(r[0].licence, "cc0-1.0");
  assert.equal(seen[0].headers.Authorization, `Basic ${Buffer.from("me:0123456789abcdef0123").toString("base64")}`);
  const plan = await k.fetchPlan("https://www.kaggle.com/datasets/heptapod/titanic");
  assert.equal(plan.files[0].url, "https://www.kaggle.com/api/v1/datasets/download/heptapod/titanic");
  assert.equal(plan.credential, "kaggle");
  assert.equal(plan.extract, true);
});

test("links: https only, never private networks, only files Continuum can read", async () => {
  const u = urlConnector();
  const d = await u.describe("https://example.org/data/cities.csv");
  assert.equal(d.title, "cities");
  assert.equal((await u.describe("https://github.com/mwaskom/seaborn-data/archive/refs/heads/master.zip")).title, "seaborn data");
  assert.equal(d.modalities[0], "tabular");
  assert.equal((await u.fetchPlan("https://example.org/a/data.zip")).extract, true);
  for (const bad of ["http://example.org/a.csv", "https://localhost/a.csv", "https://192.168.1.4/a.csv", "https://10.0.0.2/a.csv", "https://me:pw@example.org/a.csv", "https://example.org/a.exe", "not a link"]) {
    await assert.rejects(u.describe(bad), (e) => e.status === 400, bad);
  }
});

test("licence names map to known licences", () => {
  assert.equal(licenceId("CC BY-SA 4.0"), "cc-by-sa-4.0");
  assert.equal(licenceId("Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)"), "cc-by-nc-4.0");
  assert.equal(licenceId("Database: Open Database, Contents: Database Contents"), "odbl");
  assert.equal(licenceId("Apache 2.0"), "apache-2.0");
  assert.equal(licenceId(""), "unknown");
});

test("sealed tokens open only with the right key", () => {
  const s = seal("key-one", "me:secret");
  assert.ok(!s.includes("secret"));
  assert.equal(open("key-one", s), "me:secret");
  assert.throws(() => open("key-two", s));
});

let t;
before(async () => {
  t = await startTestEngine({ name: "sources" });
  t.engine.cfg.secretKey = "test-secret";
  const { credentialStore } = await import("../src/credentials.js");
  t.engine.credentials = credentialStore(t.engine.db, "test-secret");
  t.engine.connectors.url = urlConnector();
  t.engine.connectors.kaggle = { ...kaggle({ fetchImpl: async () => new Response("[]") }), describe: async (ref) => ({ connector: "kaggle", ref, title: "Titanic", licence: "cc0-1.0", modalities: ["tabular"], tasks: [], size: {}, tags: [] }) };
  // the fake worker needs the same credentials
  await t.engine.worker.stop(500);
  const { startWorker } = await import("./helpers.js");
  const { dataHandlers } = await import("../src/worker/handlers.js");
  await startWorker(t.engine);
  t.engine.worker.handlers = dataHandlers({ db: t.engine.db, storage: t.engine.storage, runner: t.engine.runner, credentials: t.engine.credentials, log: { info() {}, warn() {}, error() {}, child() { return this; } } });
});
after(() => t.stop());

test("tokens are saved sealed and never shown back", async () => {
  const api = t.api(t.users.a);
  const bad = await api("POST", "/credentials/kaggle", { value: "nope" });
  assert.equal(bad.status, 400);
  const ok = await api("POST", "/credentials/kaggle", { value: '{"username":"me","key":"0123456789abcdef0123456789abcdef"}' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.credential.hint, "cdef");
  const list = await api("GET", "/credentials");
  assert.equal(JSON.stringify(list.body).includes("0123456789abcdef"), false);
  assert.equal(list.body.credentials.find((c) => c.kind === "kaggle").saved, true);
  const raw = await t.engine.db.collection("credentials").findOne({ kind: "kaggle" });
  assert.equal(raw.sealed.includes("0123456789"), false);
  assert.equal((await t.api(t.users.b)("GET", "/credentials")).body.credentials.find((c) => c.kind === "kaggle").saved, false);
});

test("a link becomes a private source and a dataset; its archive is unpacked", async () => {
  const api = t.api(t.users.a);
  const s = await api("POST", "/sources", { url: "https://example.org/files/cities.zip" });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  assert.equal(s.body.source.private, true);
  assert.ok(!(await t.api(t.users.b)("GET", "/sources?q=cities")).body.sources.some((x) => x.id === s.body.source.id), "another user doesn't see my link");
  const d = await api("POST", "/datasets", { name: "Cities", sourceId: s.body.source.id });
  assert.equal(d.status, 201, JSON.stringify(d.body));
  await waitFor(async () => (await api("GET", `/datasets/${d.body.dataset.id}`)).body.dataset.state === "ready");
  const fetchCall = t.engine.runner.calls.find((c) => c.op === "fetch" && c.params.files[0].url.includes("cities.zip"));
  assert.equal(fetchCall.params.extract, true);
});

test("Kaggle downloads get the token for the run only", async () => {
  const api = t.api(t.users.a);
  const s = await api("POST", "/sources", { connector: "kaggle", ref: "heptapod/titanic" });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  const nobody = await t.api(t.users.b)("POST", "/datasets", { name: "T", sourceId: s.body.source.id });
  assert.equal(nobody.status, 403, "no token, no Kaggle dataset");
  const d = await api("POST", "/datasets", { name: "Titanic", sourceId: s.body.source.id });
  assert.equal(d.status, 201, JSON.stringify(d.body));
  await waitFor(async () => (await api("GET", `/datasets/${d.body.dataset.id}`)).body.dataset.state === "ready");
  const call = t.engine.runner.calls.find((c) => c.op === "fetch" && c.params.files[0].url.includes("kaggle"));
  assert.match(call.params.headers.Authorization, /^Basic /);
  const run = await t.engine.db.collection("runs").findOne({ datasetId: { $exists: true }, "steps.credential": "kaggle" });
  assert.ok(run, "the run records which token it needs");
  assert.equal(JSON.stringify(run).includes("Basic "), false, "but never the token");
  const events = await t.engine.db.collection("run_events").find({ runId: run._id }).toArray();
  assert.equal(JSON.stringify(events).includes("0123456789abcdef"), false);
});
