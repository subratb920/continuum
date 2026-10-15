// src/create/versions.js
//
// The version written for each package: the newest stable release inside the
// catalogue's range (the line the official starters use), looked up when the
// project is created, from the package's own registry: npm, PyPI, the Go
// module proxy, NuGet or Maven Central. Cached for an hour; if a registry can't be reached
// the range's own minimum is used, so creation never fails on a lookup.

import semver from "semver";

const HOUR = 3600_000;
const cache = new Map(); // key → { at, versions: Map(normalised → as published) }

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function getText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
}

/** Go module paths escape capitals as !lowercase */
const goEscape = (path) => path.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);

/** registry → (name) → published version strings */
const REGISTRIES = {
  npm: (name) =>
    getJson(`https://registry.npmjs.org/${name.replace("/", "%2f")}`, { Accept: "application/vnd.npm.install-v1+json" }).then((d) =>
      Object.keys(d.versions ?? {})
    ),
  pypi: (name) => getJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`).then((d) => Object.keys(d.releases ?? {})),
  go: (name) => getText(`https://proxy.golang.org/${goEscape(name)}/@v/list`).then((t) => t.split("\n").filter(Boolean)),
  nuget: (name) => getJson(`https://api.nuget.org/v3-flatcontainer/${name.toLowerCase()}/index.json`).then((d) => d.versions ?? []),
  /** "group:artifact" from Maven Central's maven-metadata.xml */
  maven: (name) => {
    const [group, artifact] = name.split(":");
    return getText(`https://repo1.maven.org/maven2/${group.replaceAll(".", "/")}/${artifact}/maven-metadata.xml`).then((xml) =>
      [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1])
    );
  },
};

/** "6.1" → "6.1.0", "v1.2.3" → "1.2.3", "33.4.8-jre" → "33.4.8"; null for pre-releases and anything unusual */
function normalise(v) {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-jre)?$/.exec(v);
  return m ? `${m[1]}.${m[2] ?? 0}.${m[3] ?? 0}` : null;
}

async function published(registry, name, now = Date.now()) {
  const key = `${registry}:${name}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < HOUR) return hit.versions;
  const versions = new Map();
  for (const v of await REGISTRIES[registry](name)) {
    const n = normalise(v);
    if (n) versions.set(n, v);
  }
  cache.set(key, { at: now, versions });
  return versions;
}

/**
 * The newest stable version of `name` within the semver `range`, as the
 * registry publishes it ("6.1", "v1.12.0", "19.3.1"), or the range's minimum.
 */
export async function resolveVersion(registry, name, range) {
  try {
    const versions = await published(registry, name);
    const best = semver.maxSatisfying([...versions.keys()], range);
    if (best) return versions.get(best);
  } catch {
    /* registry unreachable: fall back below */
  }
  const min = semver.minVersion(range)?.version ?? null;
  return min && registry === "go" ? `v${min}` : min;
}

/** For tests */
export function clearVersionCache() {
  cache.clear();
}
