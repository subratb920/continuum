import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRepoName, createRepo, githubAccount, repoAvailable } from "../src/create/github.js";

/** A fake GitHub: records calls, answers from a table of "METHOD path" → [status, body] */
function fakeGithub(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ method: init.method, path, auth: init.headers.Authorization, body: init.body ? JSON.parse(init.body) : null });
    const [status, body] = routes[`${init.method} ${path}`] ?? [404, { message: "Not Found" }];
    return { status, json: async () => body };
  };
  return { calls, fetchImpl };
}

test("github: repository names follow GitHub's rule", () => {
  assert.equal(checkRepoName(" my-app.v2_x "), "my-app.v2_x");
  for (const bad of ["", ".", "..", "has space", "a/b", "x".repeat(101), "name.git", 42]) {
    assert.throws(() => checkRepoName(bad), /Repository name/, String(bad));
  }
});

test("github: account, availability and creation, with the token only in the Authorization header", async () => {
  const gh = fakeGithub({
    "GET /user": [200, { login: "octo", name: "Octo Cat" }],
    "GET /repos/octo/taken": [200, { id: 1 }],
    "POST /user/repos": [201, { html_url: "https://github.com/octo/new-app", clone_url: "https://github.com/octo/new-app.git", full_name: "octo/new-app" }],
  });
  const opts = { fetchImpl: gh.fetchImpl };
  assert.deepEqual(await githubAccount("tok", opts), { login: "octo", name: "Octo Cat" });
  assert.equal(await repoAvailable("tok", "octo", "taken", opts), false);
  assert.equal(await repoAvailable("tok", "octo", "free", opts), true);
  const repo = await createRepo("tok", { name: "new-app", description: "d", isPrivate: true }, opts);
  assert.equal(repo.cloneUrl, "https://github.com/octo/new-app.git");
  const post = gh.calls.find((c) => c.method === "POST");
  assert.deepEqual(post.body, { name: "new-app", description: "d", private: true, auto_init: false }, "empty repo, so the first commit pushes cleanly");
  assert.ok(gh.calls.every((c) => c.auth === "Bearer tok"));
  assert.ok(!JSON.stringify(repo).includes("tok"), "the token isn't in what comes back");
});

test("github: expired sign-in, name taken and outages give clear errors", async () => {
  const expired = fakeGithub({ "GET /user": [401, {}] });
  await assert.rejects(githubAccount("t", { fetchImpl: expired.fetchImpl }), /sign in with GitHub again/);
  const taken = fakeGithub({ "POST /user/repos": [422, {}] });
  await assert.rejects(createRepo("t", { name: "x" }, { fetchImpl: taken.fetchImpl }), (e) => e.statusCode === 409 && e.field === "git.github.name");
  const down = fakeGithub({ "GET /repos/o/n": [500, {}] });
  await assert.rejects(repoAvailable("t", "o", "n", { fetchImpl: down.fetchImpl }), /couldn't be reached/);
});
