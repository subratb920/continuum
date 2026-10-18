import { test } from "node:test";
import assert from "node:assert/strict";
import { deviceApp, runtimeOf } from "../src/oauth/detect-runtime.js";

const pkg = (o) => JSON.stringify(o);

test("runtime: a Vite React app (the wizard's) is a static front end, built into dist/ with its own package manager", () => {
  const files = [{ path: "package.json", text: pkg({ scripts: { dev: "vite", build: "tsc -b && vite build", preview: "vite preview" }, dependencies: { react: "^19" }, devDependencies: { vite: "^8" } }) }];
  const r = runtimeOf(files, ["package.json", "index.html", "src/main.tsx", "pnpm-lock.yaml"], "");
  assert.equal(r.kind, "static");
  assert.equal(r.outDir, "dist");
  assert.equal(r.packageManager, "pnpm");
  assert.equal(r.buildScript, "build");
});

test("runtime: Vite's outDir and Angular's outputPath are read from their config; a folder app uses its own files", () => {
  const vite = runtimeOf(
    [{ path: "web/package.json", text: pkg({ scripts: { build: "vite build" }, devDependencies: { vite: "^8" } }) }, { path: "web/vite.config.ts", text: "export default { build: { outDir: './public-site' } }" }],
    ["web/package.json", "web/vite.config.ts"],
    "web",
  );
  assert.equal(vite.outDir, "public-site");
  const ng = runtimeOf(
    [{ path: "package.json", text: pkg({ scripts: { build: "ng build" }, devDependencies: { "@angular/build": "^20" } }) }, { path: "angular.json", text: pkg({ projects: { shop: { architect: { build: { options: { outputPath: "dist/shop" } } } } } }) }],
    ["package.json", "angular.json"],
    "",
  );
  assert.equal(ng.outDir, "dist/shop/browser");
});

test("runtime: servers are servers (start script, server dependency, an existing main file)", () => {
  assert.equal(runtimeOf([{ path: "package.json", text: pkg({ scripts: { start: "node server.js" } }) }], ["package.json"], "").kind, "server");
  assert.equal(runtimeOf([{ path: "package.json", text: pkg({ scripts: { build: "vite build" }, dependencies: { express: "^5" }, devDependencies: { vite: "^8" } }) }], ["package.json"], "").kind, "server", "a Vite front end with an Express server isn't static");
  assert.equal(runtimeOf([{ path: "package.json", text: pkg({ main: "app.js" }) }], ["package.json", "app.js"], "").kind, "server");
  assert.equal(runtimeOf([{ path: "package.json", text: pkg({ dependencies: { next: "^16" }, scripts: { build: "next build" } }) }], ["package.json"], "").kind, "server");
});

test("runtime: plain HTML is static as it is; a Node app with nothing to start is 'none'; other languages are null", () => {
  const html = runtimeOf([], ["index.html", "styles.css"], "");
  assert.deepEqual([html.kind, html.outDir, html.buildScript], ["static", ".", null]);
  const none = runtimeOf([{ path: "package.json", text: pkg({ scripts: { test: "vitest" } }) }], ["package.json", "lib/util.js"], "");
  assert.equal(none.kind, "none");
  assert.equal(runtimeOf([], ["go.mod", "main.go"], ""), null);
});

test("device apps: Electron and Capacitor apps and native Android projects are for devices, not the cloud", () => {
  const electron = [{ path: "chat-electron-app/package.json", text: pkg({ main: "main.js", devDependencies: { electron: "^38", "electron-builder": "^26" } }) }];
  assert.deepEqual(deviceApp(electron, ["chat-electron-app/package.json", "chat-electron-app/main.js"], "chat-electron-app"), { platform: "desktop", evidence: ["depends on electron, electron-builder"] });
  const capacitor = [{ path: "mobile/package.json", text: pkg({ dependencies: { "@capacitor/core": "^7", "@capacitor/android": "^7" } }) }];
  assert.equal(deviceApp(capacitor, ["mobile/package.json"], "mobile").platform, "mobile");
  assert.equal(deviceApp([], ["mobile/android/build.gradle", "mobile/android/app/src/main/AndroidManifest.xml"], "mobile/android").platform, "mobile");
  // A server and a web front end are not
  const server = [{ path: "api/package.json", text: pkg({ scripts: { start: "node app.js" }, dependencies: { express: "^5" } }) }];
  assert.equal(deviceApp(server, ["api/package.json"], "api"), null);
  assert.equal(deviceApp([], ["chatbot/requirements.txt"], "chatbot"), null);
});
