import { test } from "node:test";
import assert from "node:assert/strict";
import { clientAuthCallbackUrl, githubAuthorizeUrl, githubCallbackUrl } from "../src/config/urls.js";

const withEnv = (vars, fn) => {
  const before = { ...process.env };
  Object.assign(process.env, vars);
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
  try {
    fn();
  } finally {
    process.env = before;
  }
};

test("after sign-in: CLIENT_AUTH_CALLBACK_URL, else <CLIENT_ORIGIN>/auth/callback (no fixed localhost)", () => {
  withEnv({ CLIENT_AUTH_CALLBACK_URL: undefined, CLIENT_ORIGIN: "http://localhost:45173/" }, () => {
    assert.equal(clientAuthCallbackUrl("abc"), "http://localhost:45173/auth/callback?token=abc");
  });
  withEnv({ CLIENT_AUTH_CALLBACK_URL: "http://ui.example/auth/callback", CLIENT_ORIGIN: "http://localhost:45173" }, () => {
    assert.equal(clientAuthCallbackUrl("abc"), "http://ui.example/auth/callback?token=abc");
  });
});

test("GitHub sign-in sends the registered callback when GITHUB_CALLBACK_URL is set", () => {
  withEnv({ GITHUB_CLIENT_ID: "id1", GITHUB_CALLBACK_URL: "http://api.example/auth/github/callback" }, () => {
    const u = new URL(githubAuthorizeUrl("user:email repo"));
    assert.equal(u.searchParams.get("client_id"), "id1");
    assert.equal(u.searchParams.get("scope"), "user:email repo");
    assert.equal(u.searchParams.get("redirect_uri"), "http://api.example/auth/github/callback");
    assert.equal(githubCallbackUrl(), "http://api.example/auth/github/callback");
  });
  withEnv({ GITHUB_CLIENT_ID: "id1", GITHUB_CALLBACK_URL: undefined }, () => {
    assert.equal(new URL(githubAuthorizeUrl("user:email")).searchParams.has("redirect_uri"), false);
    assert.equal(githubCallbackUrl(), null);
  });
});
