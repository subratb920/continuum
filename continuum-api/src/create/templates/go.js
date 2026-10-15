// src/create/templates/go.js
//
// Go web services: the standard library (net/http), Gin, Echo and Fiber.
// go.mod lists each module at its newest version (from the Go module proxy);
// `go mod tidy` fills in go.sum on the first run. Slots: goStartup (code run
// in main before serving, with ctx), goImportsMain (extra imports for main.go),
// goMiddleware (router setup lines).

const GO_VERSION = "1.25";

const goString = (s) => JSON.stringify(String(s)); // a Go string literal

export const GO_GITIGNORE = `# Binaries
/bin/
*.exe
*.exe~
*.dll
*.so
*.dylib
/${"{name}"}

# Test binaries and coverage
*.test
*.out
coverage.*

# Go workspace file
go.work
go.work.sum

# Environment (keep .env.example)
.env
.env.*
!.env.example

# Editors and OS
.idea/
.vscode/*
!.vscode/extensions.json
.DS_Store
`;

/** The framework's router, handlers and test, per variant */
const FRAMEWORKS = {
  stdlib: {
    module: null,
    imports: ['"net/http"'],
    router: (mw) => `mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", index)
	mux.HandleFunc("GET /health", health)

	var handler http.Handler = mux${mw.map((m) => `\n\t${m}`).join("")}
	return handler`,
    routerType: "http.Handler",
    handlers: (name) => `func index(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"name": ${goString(name)}, "message": "Hello from Go"})
}

func health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}`,
    handlerImports: ['"encoding/json"', '"net/http"'],
    serve: 'log.Fatal(http.ListenAndServe(":"+port, newRouter()))',
    test: `req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	newRouter().ServeHTTP(rec, req)`,
  },
  gin: {
    module: "github.com/gin-gonic/gin",
    imports: ['"github.com/gin-gonic/gin"'],
    router: (mw) => `r := gin.Default()${mw.map((m) => `\n\t${m}`).join("")}
	r.GET("/", index)
	r.GET("/health", health)
	return r`,
    routerType: "*gin.Engine",
    handlers: (name) => `func index(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"name": ${goString(name)}, "message": "Hello from Gin"})
}

func health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}`,
    handlerImports: ['"net/http"', '"github.com/gin-gonic/gin"'],
    serve: 'log.Fatal(newRouter().Run(":" + port))',
    test: `req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	newRouter().ServeHTTP(rec, req)`,
  },
  echo: {
    module: "github.com/labstack/echo/v4",
    imports: ['"github.com/labstack/echo/v4"'],
    router: (mw) => `e := echo.New()
	e.HideBanner = true${mw.map((m) => `\n\t${m}`).join("")}
	e.GET("/", index)
	e.GET("/health", health)
	return e`,
    routerType: "*echo.Echo",
    handlers: (name) => `func index(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]string{"name": ${goString(name)}, "message": "Hello from Echo"})
}

func health(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
}`,
    handlerImports: ['"net/http"', '"github.com/labstack/echo/v4"'],
    serve: 'log.Fatal(newRouter().Start(":" + port))',
    test: `req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	newRouter().ServeHTTP(rec, req)`,
  },
  fiber: {
    module: "github.com/gofiber/fiber/v3",
    imports: ['"github.com/gofiber/fiber/v3"'],
    router: (mw) => `app := fiber.New()${mw.map((m) => `\n\t${m}`).join("")}
	app.Get("/", index)
	app.Get("/health", health)
	return app`,
    routerType: "*fiber.App",
    handlers: (name) => `func index(c fiber.Ctx) error {
	return c.JSON(fiber.Map{"name": ${goString(name)}, "message": "Hello from Fiber"})
}

func health(c fiber.Ctx) error {
	return c.JSON(fiber.Map{"status": "ok"})
}`,
    handlerImports: ['"github.com/gofiber/fiber/v3"'],
    serve: 'log.Fatal(newRouter().Listen(":" + port))',
    test: `req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec, err := newRouter().Test(req)
	if err != nil {
		t.Fatal(err)
	}`,
    testStatus: "rec.StatusCode",
    testBody: "io.ReadAll(rec.Body)",
  },
};

/** An import block: standard library first, then modules, as gofmt/goimports group them */
function importBlock(list) {
  const unique = [...new Set(list)];
  // gofmt sorts by the import path, whatever alias ("_", a name) comes before it
  const path = (i) => i.slice(i.indexOf('"') + 1, -1);
  const byPath = (a, b) => (path(a) < path(b) ? -1 : path(a) > path(b) ? 1 : 0);
  const isStd = (i) => !path(i).split("/")[0].includes(".");
  const std = unique.filter(isStd).sort(byPath);
  const mods = unique.filter((i) => !isStd(i)).sort(byPath);
  const groups = [std, mods].filter((g) => g.length).map((g) => g.map((i) => `\t${i}`).join("\n"));
  return `import (\n${groups.join("\n\n")}\n)`;
}

export function goTemplate(framework) {
  const fw = FRAMEWORKS[framework];
  return {
    manifest: "go",
    prepare(ctx) {
      if (fw.module) ctx.pkg("go", fw.module, framework === "fiber" ? ">=3.0.0 <4.0.0" : framework === "echo" ? ">=4.0.0 <5.0.0" : ">=1.0.0 <2.0.0");
    },
    build(ctx) {
      const startup = ctx.slots.goStartup ?? [];
      const mw = ctx.slots.goMiddleware ?? [];
      ctx.add(".gitignore", GO_GITIGNORE.replace("{name}", ctx.details.name));
      ctx.env.unshift(["PORT", "8080", "Port the server listens on"]);
      ctx.add(
        "main.go",
        `// ${ctx.details.description || `${ctx.details.name}: a ${ctx.variant.name} web service.`}
package main

${importBlock(['"log"', '"os"', ...(startup.length ? ['"context"'] : []), ...fw.imports.filter((i) => framework !== "stdlib" || i !== '"net/http"'), ...(framework === "stdlib" ? ['"net/http"'] : []), ...(ctx.slots.goImportsMain ?? [])])}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
${startup.length ? `\n\tctx := context.Background()\n${startup.map((s) => `\t${s.replaceAll("\n", "\n\t")}\n`).join("")}` : ""}
	log.Printf("Listening on http://localhost:%s", port)
	${fw.serve}
}

// newRouter sets up the routes; the tests use it too.
func newRouter() ${fw.routerType} {
	${fw.router(mw)}
}
`
      );
      ctx.add("handlers.go", `package main\n\n${importBlock(fw.handlerImports)}\n\n${fw.handlers(ctx.details.name)}\n`);
      ctx.add(
        "main_test.go",
        `package main

${importBlock(['"io"', '"net/http"', '"net/http/httptest"', '"testing"'])}

func TestHealth(t *testing.T) {
	${fw.test}

	if got := ${fw.testStatus ?? "rec.Code"}; got != http.StatusOK {
		t.Fatalf("status = %d, want %d", got, http.StatusOK)
	}
	body, _ := ${fw.testBody ?? "io.ReadAll(rec.Body)"}
	if want := \`{"status":"ok"}\`; !jsonEqual(string(body), want) {
		t.Fatalf("body = %s, want %s", body, want)
	}
}

// jsonEqual ignores the trailing newline some encoders add
func jsonEqual(a, b string) bool {
	trim := func(s string) string {
		for len(s) > 0 && (s[len(s)-1] == '\\n' || s[len(s)-1] == ' ') {
			s = s[:len(s)-1]
		}
		return s
	}
	return trim(a) == trim(b)
}
`
      );
      ctx.readme.setup.push("go mod tidy", "go run .");
      ctx.readme.notes.push(
        "Open http://localhost:8080 (`PORT` in the environment).",
        "- `go test ./...` runs the tests; `go build -o bin/app .` builds the binary.",
        `Requires Go ${GO_VERSION} or newer.`
      );
    },
    /** go.mod: the module path and each module at its resolved version */
    finish(ctx, versions) {
      const requires = [...ctx.packages.go.keys()].sort().map((name) => `\t${name} ${versions.go.get(name)?.version ?? "latest"}`);
      ctx.add("go.mod", `module ${ctx.details.module}\n\ngo ${GO_VERSION}\n${requires.length ? `\nrequire (\n${requires.join("\n")}\n)\n` : ""}`);
    },
  };
}
