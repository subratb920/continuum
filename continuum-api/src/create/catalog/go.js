// src/create/catalog/go.js
//
// Go web services: standard library, Gin, Echo, Fiber.

import { field } from "../fields.js";
import { goTemplate } from "../templates/go.js";

const DETAILS = [
  field("name", "Project name", "slug", { placeholder: "my-service", default: "my-service", help: "Also the folder's and binary's name" }),
  field("module", "Module path", "goModule", {
    required: false,
    placeholder: "github.com/you/my-service",
    help: "Usually where the code will live, e.g. github.com/you/my-service",
    derive: { from: ["name"], transform: "goModule" },
  }),
  field("description", "Description", "text", { required: false, placeholder: "What it does" }),
];

const GROUPS = [
  { id: "web", name: "Web" },
  { id: "databases", name: "Databases" },
  { id: "auth", name: "Authentication" },
  { id: "config", name: "Configuration" },
  { id: "logging", name: "Logging" },
  { id: "testing", name: "Testing" },
];

const go = (name, range) => ({ registry: "go", name, range });
const ALL = ["stdlib", "gin", "echo", "fiber"];

/** A file in package main with its own imports */
const goFile = (imports, body) => `package main\n\nimport (\n${imports.map((i) => (i ? `\t${i}` : "")).join("\n")}\n)\n\n${body}\n`;

const DEPENDENCIES = [
  {
    id: "cors",
    name: "CORS",
    description: "Let browsers on other origins call the API.",
    group: "web",
    docs: "https://developer.mozilla.org/docs/Web/HTTP/CORS",
    apply(ctx) {
      switch (ctx.variant.id) {
        case "stdlib":
          ctx.pkg("go", "github.com/rs/cors", ">=1.11.0 <2.0.0");
          ctx.slot("goImportsMain", '"github.com/rs/cors"');
          ctx.slot("goMiddleware", "handler = cors.Default().Handler(handler)");
          break;
        case "gin":
          ctx.pkg("go", "github.com/gin-contrib/cors", ">=1.7.0 <2.0.0");
          ctx.slot("goImportsMain", '"github.com/gin-contrib/cors"');
          ctx.slot("goMiddleware", "r.Use(cors.Default())");
          break;
        case "echo":
          ctx.slot("goImportsMain", '"github.com/labstack/echo/v4/middleware"');
          ctx.slot("goMiddleware", "e.Use(middleware.CORS())");
          break;
        case "fiber":
          ctx.slot("goImportsMain", '"github.com/gofiber/fiber/v3/middleware/cors"');
          ctx.slot("goMiddleware", "app.Use(cors.New())");
          break;
      }
    },
  },
  {
    id: "pgx",
    name: "PostgreSQL (pgx)",
    description: "A PostgreSQL connection pool from DATABASE_URL, opened at start-up.",
    group: "databases",
    icon: "SiPostgresql",
    docs: "https://github.com/jackc/pgx",
    packages: [go("github.com/jackc/pgx/v5", ">=5.0.0 <6.0.0")],
    apply(ctx) {
      ctx.add(
        "postgres.go",
        goFile(['"context"', "", '"github.com/jackc/pgx/v5/pgxpool"'], `// connectPostgres opens a pool and checks the connection.
func connectPostgres(ctx context.Context, url string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}`)
      );
      ctx.slot(
        "goStartup",
        `if url := os.Getenv("DATABASE_URL"); url != "" {
	pool, err := connectPostgres(ctx, url)
	if err != nil {
		log.Fatalf("postgres: %v", err)
	}
	defer pool.Close()
}`
      );
      ctx.env.push(["DATABASE_URL", "postgres://postgres:postgres@localhost:5432/postgres", "PostgreSQL connection string"]);
    },
  },
  {
    id: "mongo",
    name: "MongoDB",
    description: "The official MongoDB driver, connected from MONGO_URL at start-up.",
    group: "databases",
    icon: "SiMongodb",
    docs: "https://www.mongodb.com/docs/drivers/go/current/",
    packages: [go("go.mongodb.org/mongo-driver/v2", ">=2.0.0 <3.0.0")],
    apply(ctx) {
      ctx.add(
        "mongo.go",
        goFile(['"context"', "", '"go.mongodb.org/mongo-driver/v2/mongo"', '"go.mongodb.org/mongo-driver/v2/mongo/options"'], `// connectMongo connects and checks the connection.
func connectMongo(ctx context.Context, url string) (*mongo.Client, error) {
	client, err := mongo.Connect(options.Client().ApplyURI(url))
	if err != nil {
		return nil, err
	}
	if err := client.Ping(ctx, nil); err != nil {
		return nil, err
	}
	return client, nil
}`)
      );
      ctx.slot(
        "goStartup",
        `if url := os.Getenv("MONGO_URL"); url != "" {
	client, err := connectMongo(ctx, url)
	if err != nil {
		log.Fatalf("mongo: %v", err)
	}
	defer func() { _ = client.Disconnect(ctx) }()
}`
      );
      ctx.env.push(["MONGO_URL", "mongodb://localhost:27017", "MongoDB connection string"]);
    },
  },
  {
    id: "redis",
    name: "Redis",
    description: "go-redis, connected from REDIS_URL at start-up.",
    group: "databases",
    icon: "SiRedis",
    docs: "https://redis.uptrace.dev/",
    packages: [go("github.com/redis/go-redis/v9", ">=9.0.0 <10.0.0")],
    apply(ctx) {
      ctx.add(
        "redis.go",
        goFile(['"context"', "", '"github.com/redis/go-redis/v9"'], `// connectRedis connects and checks the connection.
func connectRedis(ctx context.Context, url string) (*redis.Client, error) {
	opts, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	client := redis.NewClient(opts)
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, err
	}
	return client, nil
}`)
      );
      ctx.slot(
        "goStartup",
        `if url := os.Getenv("REDIS_URL"); url != "" {
	rdb, err := connectRedis(ctx, url)
	if err != nil {
		log.Fatalf("redis: %v", err)
	}
	defer func() { _ = rdb.Close() }()
}`
      );
      ctx.env.push(["REDIS_URL", "redis://localhost:6379/0", "Redis connection string"]);
    },
  },
  {
    id: "jwt",
    name: "JSON Web Tokens",
    description: "Sign and check JWTs with golang-jwt (secret from JWT_SECRET).",
    group: "auth",
    icon: "SiJsonwebtokens",
    docs: "https://golang-jwt.github.io/jwt/",
    packages: [go("github.com/golang-jwt/jwt/v5", ">=5.0.0 <6.0.0")],
    apply(ctx) {
      ctx.add(
        "auth.go",
        goFile(['"errors"', '"os"', '"time"', "", '"github.com/golang-jwt/jwt/v5"'], `func jwtSecret() ([]byte, error) {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		return nil, errors.New("JWT_SECRET is not set")
	}
	return []byte(secret), nil
}

// signToken makes a token for subject, valid for an hour.
func signToken(subject string) (string, error) {
	secret, err := jwtSecret()
	if err != nil {
		return "", err
	}
	claims := jwt.RegisteredClaims{Subject: subject, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(secret)
}

// verifyToken returns the token's subject when it is valid.
func verifyToken(token string) (string, error) {
	secret, err := jwtSecret()
	if err != nil {
		return "", err
	}
	claims := &jwt.RegisteredClaims{}
	if _, err := jwt.ParseWithClaims(token, claims, func(*jwt.Token) (any, error) { return secret, nil }, jwt.WithValidMethods([]string{"HS256"})); err != nil {
		return "", err
	}
	return claims.Subject, nil
}`)
      );
      ctx.env.push(["JWT_SECRET", "", "A long random value used to sign tokens (keep it secret)"]);
    },
  },
  {
    id: "godotenv",
    name: "godotenv",
    description: "Load settings from a .env file at start-up.",
    group: "config",
    icon: "SiDotenv",
    docs: "https://github.com/joho/godotenv",
    packages: [go("github.com/joho/godotenv", ">=1.5.0 <2.0.0")],
    apply(ctx) {
      ctx.slot("goImportsMain", '_ "github.com/joho/godotenv/autoload"');
    },
  },
  {
    id: "zerolog",
    name: "zerolog",
    description: "Fast, structured JSON logging.",
    group: "logging",
    docs: "https://github.com/rs/zerolog",
    packages: [go("github.com/rs/zerolog", ">=1.30.0 <2.0.0")],
    apply(ctx) {
      ctx.add(
        "logger.go",
        goFile(['"os"', "", '"github.com/rs/zerolog"'], "// logger writes structured JSON logs.\nvar logger = zerolog.New(os.Stdout).With().Timestamp().Logger()")
      );
    },
  },
  {
    id: "testify",
    name: "Testify",
    description: "Assertions and mocks for tests.",
    group: "testing",
    docs: "https://github.com/stretchr/testify",
    packages: [go("github.com/stretchr/testify", ">=1.9.0 <2.0.0")],
    apply(ctx) {
      ctx.add(
        "assert_test.go",
        goFile(['"testing"', "", '"github.com/stretchr/testify/assert"'], `func TestNewRouter(t *testing.T) {
	assert.NotNil(t, newRouter())
}`)
      );
    },
  },
];

const variant = (id, name, icon, description) => ({ id, name, icon, description, options: [], details: DETAILS, template: goTemplate(id) });

export default {
  id: "go",
  name: "Go",
  icon: "SiGo",
  description: "Fast, simple web services and tools in Go.",
  groups: GROUPS,
  variants: [
    variant("stdlib", "Standard library", "SiGo", "net/http only: Go's own router, no framework."),
    variant("gin", "Gin", "SiGin", "The most used Go web framework: fast, with middleware."),
    variant("echo", "Echo", "SiGo", "A minimalist, extensible web framework."),
    variant("fiber", "Fiber", "SiGo", "An Express-inspired framework built on fasthttp."),
  ],
  dependencies: DEPENDENCIES.map((d) => ({ ...d, appliesTo: d.appliesTo ?? ALL })),
};
