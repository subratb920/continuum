// src/create/catalog/java.js
//
// A plain Java application with Maven or Gradle (for Spring, see spring.js).

import { field } from "../fields.js";
import { javaTemplate } from "../templates/java.js";

const lib = (coords, range, scope = "compile") => ({ coords, range, scope });

/** A dependency that adds Java libraries (resolved on Maven Central) */
function javaDep(base, libs) {
  return {
    ...base,
    apply(ctx) {
      for (const l of libs) {
        ctx.pkg("maven", l.coords, l.range);
        ctx.slot("javaDeps", { coords: l.coords, scope: l.scope });
      }
    },
  };
}

const DEPENDENCIES = [
  javaDep({ id: "guava", name: "Guava", description: "Google's core libraries: collections, caching, strings…", group: "libraries", docs: "https://github.com/google/guava" }, [
    lib("com.google.guava:guava", ">=33.0.0 <34.0.0"),
  ]),
  javaDep({ id: "jackson", name: "Jackson", description: "JSON reading and writing.", group: "libraries", docs: "https://github.com/FasterXML/jackson" }, [
    lib("com.fasterxml.jackson.core:jackson-databind", ">=2.17.0 <3.0.0"),
  ]),
  javaDep({ id: "logging", name: "SLF4J + Logback", description: "Logging API with Logback behind it.", group: "logging", docs: "https://logback.qos.ch/" }, [
    lib("org.slf4j:slf4j-api", ">=2.0.0 <3.0.0"),
    lib("ch.qos.logback:logback-classic", ">=1.5.0 <2.0.0"),
  ]),
  javaDep({ id: "lombok", name: "Lombok", description: "Less boilerplate: getters, builders, constructors from annotations.", group: "libraries", docs: "https://projectlombok.org/" }, [
    lib("org.projectlombok:lombok", ">=1.18.30 <2.0.0", "provided"),
  ]),
  javaDep({ id: "assertj", name: "AssertJ", description: "Fluent assertions for tests.", group: "testing", docs: "https://assertj.github.io/doc/" }, [
    lib("org.assertj:assertj-core", ">=3.25.0 <4.0.0", "test"),
  ]),
  javaDep({ id: "mockito", name: "Mockito", description: "Mocks for unit tests.", group: "testing", docs: "https://site.mockito.org/" }, [
    lib("org.mockito:mockito-core", ">=5.0.0 <6.0.0", "test"),
    lib("org.mockito:mockito-junit-jupiter", ">=5.0.0 <6.0.0", "test"),
  ]),
];

export default {
  id: "java",
  name: "Java",
  icon: "SiOpenjdk",
  description: "Plain Java applications and libraries, with Maven or Gradle.",
  groups: [
    { id: "libraries", name: "Libraries" },
    { id: "logging", name: "Logging" },
    { id: "testing", name: "Testing" },
  ],
  variants: [
    {
      id: "app",
      name: "Java application",
      icon: "SiOpenjdk",
      description: "A Java program with a main class, JUnit 5 tests and a build wrapper.",
      options: [
        {
          id: "build",
          label: "Build",
          type: "choice",
          values: [
            { id: "maven", label: "Maven", icon: "SiApachemaven" },
            { id: "gradle", label: "Gradle (Kotlin DSL)", icon: "SiGradle" },
          ],
          default: "maven",
        },
        {
          id: "javaVersion",
          label: "Java",
          type: "choice",
          values: [
            { id: "25", label: "25 (LTS)" },
            { id: "21", label: "21 (LTS)" },
          ],
          default: "25",
        },
      ],
      details: [
        field("group", "Group", "javaGroup", { default: "com.example", placeholder: "com.example" }),
        field("artifact", "Artifact", "javaArtifact", { default: "my-app", placeholder: "my-app", help: "Also the folder's name" }),
        field("description", "Description", "text", { required: false, placeholder: "What it does" }),
        field("packageName", "Package name", "javaPackage", { required: false, placeholder: "com.example.my_app", derive: { from: ["group", "artifact"], transform: "javaPackage" } }),
      ],
      template: javaTemplate,
    },
  ],
  dependencies: DEPENDENCIES.map((d) => ({ ...d, appliesTo: "*" })),
};
