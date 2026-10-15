// src/create/templates/java.js
//
// A plain Java application (no framework) with Maven or Gradle (Kotlin DSL),
// JUnit 5 tests and the build tool's wrapper. The wrapper scripts come from a
// Spring Initializr starter of the same build type, so they're always current;
// if start.spring.io can't be reached, the README says to install the tool.
// Slots: javaDeps ([{ coords, scope }]) filled by dependencies.

import { INITIALIZR } from "./spring.js";
import { readTarGz } from "../tar.js";

const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

export const JAVA_GITIGNORE = `# Build output
target/
build/
out/
bin/
.gradle/
!gradle/wrapper/gradle-wrapper.jar
!.mvn/wrapper/maven-wrapper.jar

# IDEs
.idea/
*.iml
*.iws
.vscode/*
!.vscode/extensions.json
.settings/
.project
.classpath
.factorypath

# Environment (keep .env.example)
.env
.env.*
!.env.example

# OS
.DS_Store
`;

/** The Maven or Gradle wrapper files from an empty Spring starter of that build type */
async function wrapperFiles(type, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`${INITIALIZR}/starter.tgz?type=${type}&baseDir=w`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    return readTarGz(Buffer.from(await res.arrayBuffer())).filter((f) => /^(mvnw(\.cmd)?|\.mvn\/wrapper\/.*|gradlew(\.bat)?|gradle\/wrapper\/.*)$/.test(f.path));
  } catch {
    return [];
  }
}

const SCOPE_GRADLE = { compile: "implementation", test: "testImplementation", provided: "compileOnly" };

export const javaTemplate = {
  manifest: null,
  prepare(ctx) {
    ctx.pkg("maven", "org.junit:junit-bom", ">=5.11.0 <6.0.0");
    if (ctx.options.build === "maven") {
      ctx.pkg("maven", "org.apache.maven.plugins:maven-surefire-plugin", ">=3.5.0 <4.0.0");
      ctx.pkg("maven", "org.codehaus.mojo:exec-maven-plugin", ">=3.5.0 <4.0.0");
    }
  },
  async build(ctx) {
    const maven = ctx.options.build === "maven";
    const pkg = ctx.details.packageName;
    const path = pkg.replaceAll(".", "/");
    for (const f of await wrapperFiles(maven ? "maven-project" : "gradle-project-kotlin")) ctx.add(f.path, f.data, f.executable);
    const hasWrapper = ctx.files.has(maven ? "mvnw" : "gradlew");
    const tool = maven ? (hasWrapper ? "./mvnw" : "mvn") : hasWrapper ? "./gradlew" : "gradle";

    ctx.add(".gitignore", JAVA_GITIGNORE);
    ctx.add(".gitattributes", "/mvnw text eol=lf\n/gradlew text eol=lf\n*.cmd text eol=crlf\n*.bat text eol=crlf\n*.jar binary\n");
    ctx.add(
      `src/main/java/${path}/App.java`,
      `package ${pkg};

/** ${xml(ctx.details.description || `${ctx.details.artifact}: a Java application.`).replace(/\*\//g, "* /")} */
public class App {

    public static String greet(String name) {
        return "Hello from " + name + "!";
    }

    public static void main(String[] args) {
        System.out.println(greet(${JSON.stringify(ctx.details.artifact)}));
    }
}
`
    );
    ctx.add(
      `src/test/java/${path}/AppTest.java`,
      `package ${pkg};

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class AppTest {

    @Test
    void greets() {
        assertEquals("Hello from you!", App.greet("you"));
    }
}
`
    );
    ctx.readme.setup.push(maven ? `${tool} -q compile exec:java` : `${tool} run`);
    ctx.readme.notes.push(
      maven ? `- \`${tool} test\` runs the tests; \`${tool} package\` builds the jar.` : `- \`${tool} test\` runs the tests; \`${tool} build\` builds everything.`,
      `Requires Java ${ctx.options.javaVersion} or newer.`,
      hasWrapper ? `On macOS/Linux, if the wrapper won't run: \`chmod +x ${maven ? "mvnw" : "gradlew"}\`.` : `Install ${maven ? "Maven" : "Gradle"} to build (the wrapper couldn't be added).`
    );
  },
  /** pom.xml or build.gradle.kts with every library at its resolved version */
  finish(ctx, versions) {
    const v = (coords) => versions.maven.get(coords)?.version ?? null;
    const d = ctx.details;
    const deps = (ctx.slots.javaDeps ?? []).map((x) => ({ ...x, version: v(x.coords) ?? "LATEST" }));
    const junit = v("org.junit:junit-bom") ?? "5.13.0";
    if (ctx.options.build === "maven") {
      const dep = ({ coords, version, scope }) => {
        const [g, a] = coords.split(":");
        return `        <dependency>\n            <groupId>${g}</groupId>\n            <artifactId>${a}</artifactId>\n            <version>${version}</version>${scope !== "compile" ? `\n            <scope>${scope}</scope>` : ""}\n        </dependency>`;
      };
      ctx.add(
        "pom.xml",
        `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>${xml(d.group)}</groupId>
    <artifactId>${xml(d.artifact)}</artifactId>
    <version>0.1.0-SNAPSHOT</version>
    <name>${xml(d.artifact)}</name>
    <description>${xml(d.description || "")}</description>

    <properties>
        <maven.compiler.release>${ctx.options.javaVersion}</maven.compiler.release>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
        <exec.mainClass>${d.packageName}.App</exec.mainClass>
    </properties>

    <dependencyManagement>
        <dependencies>
            <dependency>
                <groupId>org.junit</groupId>
                <artifactId>junit-bom</artifactId>
                <version>${junit}</version>
                <type>pom</type>
                <scope>import</scope>
            </dependency>
        </dependencies>
    </dependencyManagement>

    <dependencies>
${[...deps.map(dep), "        <dependency>\n            <groupId>org.junit.jupiter</groupId>\n            <artifactId>junit-jupiter</artifactId>\n            <scope>test</scope>\n        </dependency>"].join("\n")}
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-surefire-plugin</artifactId>
                <version>${v("org.apache.maven.plugins:maven-surefire-plugin") ?? "3.5.2"}</version>
            </plugin>
            <plugin>
                <groupId>org.codehaus.mojo</groupId>
                <artifactId>exec-maven-plugin</artifactId>
                <version>${v("org.codehaus.mojo:exec-maven-plugin") ?? "3.5.0"}</version>
            </plugin>
        </plugins>
    </build>
</project>
`
      );
    } else {
      const line = ({ coords, version, scope }) =>
        scope === "provided"
          ? `    compileOnly("${coords}:${version}")\n    annotationProcessor("${coords}:${version}")`
          : `    ${SCOPE_GRADLE[scope]}("${coords}:${version}")`;
      ctx.add(
        "build.gradle.kts",
        `plugins {
    application
}

group = "${d.group}"
version = "0.1.0-SNAPSHOT"
description = ${JSON.stringify(d.description || "")}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(${ctx.options.javaVersion})
    }
}

repositories {
    mavenCentral()
}

dependencies {
${[...deps.map(line), `    testImplementation(platform("org.junit:junit-bom:${junit}"))`, '    testImplementation("org.junit.jupiter:junit-jupiter")', '    testRuntimeOnly("org.junit.platform:junit-platform-launcher")'].join("\n")}
}

application {
    mainClass = "${d.packageName}.App"
}

tasks.test {
    useJUnitPlatform()
}
`
      );
      ctx.add("settings.gradle.kts", `rootProject.name = "${d.artifact}"\n`);
    }
  },
};
