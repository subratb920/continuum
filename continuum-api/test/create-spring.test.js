import { test } from "node:test";
import assert from "node:assert/strict";
import { inVersionRange, setSpringMetadata } from "../src/create/templates/spring.js";
import { refreshSpring } from "../src/create/catalog/spring.js";
import { catalogJson } from "../src/create/catalog/index.js";
import { checkChoices } from "../src/create/generate.js";
import { DERIVE } from "../src/create/fields.js";

test("spring versions: Maven ranges with SNAPSHOT < M < RC < release", () => {
  assert.equal(inVersionRange("4.1.1", "[4.0.0,4.3.0-M1)"), true);
  assert.equal(inVersionRange("4.3.0-M1", "[4.0.0,4.3.0-M1)"), false);
  assert.equal(inVersionRange("4.3.0-SNAPSHOT", "[4.0.0,4.3.0-M1)"), true, "a snapshot comes before M1");
  assert.equal(inVersionRange("4.2.0-RC1", "[4.0.0,4.2.0)"), true);
  assert.equal(inVersionRange("4.2.0", "[4.0.0,4.2.0)"), false);
  assert.equal(inVersionRange("3.5.0", "4.0.0"), false, "a bare version means at least");
  assert.equal(inVersionRange("4.0.8", "4.0.0"), true);
  assert.equal(inVersionRange("4.0.0", "(4.0.0,4.1.0]"), false);
  assert.equal(inVersionRange("4.1.0", "(4.0.0,4.1.0]"), true);
});

const METADATA = {
  type: { default: "maven-project", values: [{ id: "maven-project", name: "Maven" }, { id: "maven-build", name: "Maven POM" }, { id: "gradle-project", name: "Gradle - Groovy" }, { id: "gradle-project-kotlin", name: "Gradle - Kotlin" }, { id: "gradle-build", name: "Gradle Config" }] },
  language: { default: "java", values: [{ id: "java", name: "Java" }, { id: "kotlin", name: "Kotlin" }] },
  bootVersion: { default: "4.1.1", values: [{ id: "4.2.0-M2", name: "4.2.0 (M2)" }, { id: "4.1.1", name: "4.1.1" }, { id: "4.0.8", name: "4.0.8" }] },
  javaVersion: { default: "25", values: [{ id: "25", name: "25" }, { id: "21", name: "21" }] },
  packaging: { default: "jar", values: [{ id: "jar", name: "Jar" }, { id: "war", name: "War" }] },
  groupId: { default: "com.example" },
  artifactId: { default: "demo" },
  packageName: { default: "com.example.demo" },
  dependencies: {
    values: [
      {
        name: "Web",
        values: [
          { id: "web", name: "Spring Web", description: "Build web apps", _links: { reference: { href: "https://docs.spring.io/spring-boot/{bootVersion}/reference/web/servlet.html", templated: true } } },
          { id: "newthing", name: "New Thing", description: "Only on 4.2", versionRange: "4.2.0-M1" },
        ],
      },
      { name: "SQL", values: [{ id: "postgresql", name: "PostgreSQL Driver", description: "JDBC driver" }] },
    ],
  },
};

test("spring catalogue: built from Initializr's metadata, with Boot-version limits", async () => {
  setSpringMetadata(METADATA);
  try {
    await refreshSpring();
    const kind = catalogJson().kinds.find((k) => k.id === "spring");
    assert.ok(kind, "Spring Boot is offered once the metadata has loaded");
    const v = kind.variants[0];
    assert.deepEqual(v.options.find((o) => o.id === "type").values.map((x) => x.id), ["maven-project", "gradle-project", "gradle-project-kotlin"], "only whole projects");
    assert.deepEqual(kind.groups.map((g) => g.id), ["web", "sql"]);
    const web = kind.dependencies.find((d) => d.id === "web");
    assert.equal(web.docs, "https://docs.spring.io/spring-boot/4.1.1/reference/web/servlet.html");
    assert.equal(web.when, null);
    assert.deepEqual(kind.dependencies.find((d) => d.id === "newthing").when, { bootVersion: ["4.2.0-M2"] });
    assert.equal(kind.dependencies.find((d) => d.id === "postgresql").icon, "SiPostgresql");

    const base = { kind: "spring", variant: "boot", details: { group: "com.acme", artifact: "shop" } };
    const ok = checkChoices({ ...base, dependencies: ["web"] });
    assert.equal(ok.details.packageName, "com.acme.shop", "the package follows group and artifact");
    assert.equal(ok.details.name, "shop", "the name follows the artifact");
    assert.throws(() => checkChoices({ ...base, dependencies: ["newthing"] }), /isn't available with these options/);
    assert.doesNotThrow(() => checkChoices({ ...base, options: { bootVersion: "4.2.0-M2" }, dependencies: ["newthing"] }));
  } finally {
    setSpringMetadata(null);
  }
});

test("derived details: python module, go module, java package, namespace", () => {
  assert.equal(DERIVE.snake("my-cool.app"), "my_cool_app");
  assert.equal(DERIVE.snake("9lives"), "_9lives");
  assert.equal(DERIVE.goModule("my-svc"), "example.com/my-svc");
  assert.equal(DERIVE.javaPackage("com.example", "my-app"), "com.example.my_app");
  assert.equal(DERIVE.javaPackage("com.example", "2fa"), "com.example._2fa");
  assert.equal(DERIVE.pascal("my-api"), "MyApi");
});
