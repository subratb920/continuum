import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeGithubRepoUrl } from "../src/services/githubRemote.js";

test("github remote: a plain repository address is kept", () => {
  assert.equal(normalizeGithubRepoUrl("https://github.com/subratb920/continuum"), "https://github.com/subratb920/continuum");
  assert.equal(normalizeGithubRepoUrl(" https://github.com/a-b/my.repo_1 "), "https://github.com/a-b/my.repo_1");
});

test("github remote: none given is null", () => {
  assert.equal(normalizeGithubRepoUrl(undefined), null);
  assert.equal(normalizeGithubRepoUrl(null), null);
  assert.equal(normalizeGithubRepoUrl(""), null);
});

test("github remote: credentials, other hosts, extra paths and odd values are refused", () => {
  for (const bad of [
    "https://user:token@github.com/a/b",
    "https://token@github.com/a/b",
    "http://github.com/a/b",
    "https://gitlab.com/a/b",
    "https://github.com.evil.io/a/b",
    "https://github.com/a/b/tree/main",
    "https://github.com/a/b.git",
    "https://github.com/a/..",
    "https://github.com/a",
    "git@github.com:a/b.git",
    "javascript:alert(1)",
    42,
    {},
  ]) {
    assert.throws(() => normalizeGithubRepoUrl(bad), /githubRepoUrl must look like/, String(bad));
  }
});
