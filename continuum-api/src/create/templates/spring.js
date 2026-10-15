// src/create/templates/spring.js
//
// Spring Boot through Spring Initializr (start.spring.io, Apache 2.0): its
// public metadata gives the wizard every build type, language, Boot and Java
// version and dependency (refreshed hourly), and its starter.tgz gives the
// project, exactly as start.spring.io makes it. Continuum adds its README,
// .env.example and git on top.

import { AppError } from "../../errors/AppError.js";
import { readTarGz } from "../tar.js";

export const INITIALIZR = "https://start.spring.io";
const HOUR = 3600_000;
let cached = null; // { at, metadata }

/** Initializr's metadata (cached for an hour; the last good copy if it can't be reached). */
export async function springMetadata({ now = Date.now(), fetchImpl = fetch } = {}) {
  if (cached && now - cached.at < HOUR) return cached.metadata;
  try {
    const res = await fetchImpl(`${INITIALIZR}/`, {
      headers: { Accept: "application/vnd.initializr.v2.2+json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`start.spring.io: ${res.status}`);
    cached = { at: now, metadata: await res.json() };
  } catch (e) {
    if (!cached) throw e;
    cached.at = now - HOUR + 60_000; // try again in a minute
  }
  return cached.metadata;
}

/** For tests */
export function setSpringMetadata(metadata, at = Date.now()) {
  cached = metadata ? { at, metadata } : null;
}

/* Spring versions: 4.2.0-SNAPSHOT < 4.2.0-M1 < 4.2.0-RC1 < 4.2.0 (Initializr's order) */
const QUALIFIER = { SNAPSHOT: 0, M: 1, RC: 2, "": 3 };
function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-?([A-Za-z]+)(\d*))?/.exec(String(v).trim());
  if (!m) return null;
  const q = (m[4] ?? "").toUpperCase().replace("RELEASE", "");
  return [+m[1], +m[2], +m[3], QUALIFIER[q] ?? 3, +(m[5] || 0)];
}
function compare(a, b) {
  for (let i = 0; i < 5; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Does version v fall in a Maven-style range ("[4.0.0,4.3.0-M1)", "4.0.0" = at least)? */
export function inVersionRange(v, range) {
  const ver = parseVersion(v);
  if (!ver || !range) return true;
  const m = /^([[(])\s*([^,]*)\s*,\s*([^\])]*)\s*([\])])$/.exec(range.trim());
  if (!m) {
    const min = parseVersion(range);
    return !min || compare(ver, min) >= 0;
  }
  const [, open, lo, hi, close] = m;
  const low = lo && parseVersion(lo);
  const high = hi && parseVersion(hi);
  if (low && (open === "[" ? compare(ver, low) < 0 : compare(ver, low) <= 0)) return false;
  if (high && (close === "]" ? compare(ver, high) > 0 : compare(ver, high) >= 0)) return false;
  return true;
}

/** start.spring.io's starter for the wizard's choices, as project files */
export async function springStarter(ctx, { fetchImpl = fetch } = {}) {
  const o = ctx.options;
  const d = ctx.details;
  const params = new URLSearchParams({
    type: o.type,
    language: o.language,
    bootVersion: o.bootVersion,
    javaVersion: o.javaVersion,
    packaging: o.packaging,
    groupId: d.group,
    artifactId: d.artifact,
    name: d.name,
    description: d.description || `${d.name} project`,
    packageName: d.packageName,
    baseDir: d.artifact,
  });
  const ids = ctx.deps.map((x) => x.id);
  if (ids.length) params.set("dependencies", ids.join(","));
  let res;
  try {
    res = await fetchImpl(`${INITIALIZR}/starter.tgz?${params}`, { signal: AbortSignal.timeout(20000) });
  } catch {
    throw new AppError("start.spring.io can't be reached right now; please try again in a moment.", 502, "UPSTREAM_UNAVAILABLE");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new AppError(`start.spring.io refused these choices: ${body?.message ?? res.status}`, 400, "VALIDATION_ERROR");
  }
  return readTarGz(Buffer.from(await res.arrayBuffer()));
}

export const springTemplate = {
  manifest: null,
  async build(ctx) {
    for (const f of await springStarter(ctx)) ctx.add(f.path, f.data, f.executable);
    const maven = ctx.options.type.startsWith("maven");
    ctx.readme.setup.push(maven ? "./mvnw spring-boot:run" : "./gradlew bootRun");
    ctx.readme.notes.push(
      "Open http://localhost:8080 once you add a web endpoint.",
      maven ? "- `./mvnw test` runs the tests; `./mvnw package` builds the jar." : "- `./gradlew test` runs the tests; `./gradlew bootJar` builds the jar.",
      `Requires Java ${ctx.options.javaVersion} or newer. HELP.md links to the guides for each dependency.`,
      "On macOS/Linux, if the wrapper won't run: `chmod +x " + (maven ? "mvnw" : "gradlew") + "`."
    );
  },
};
