// src/create/catalog/dotnet.js
//
// .NET 10: Web API (controllers), Minimal API, console.

import { field } from "../fields.js";
import { dotnetTemplate } from "../templates/dotnet.js";

const DETAILS = [
  field("name", "Project name", "slug", { placeholder: "my-api", default: "my-api", help: "Also the folder's and solution's name" }),
  field("namespace", "Root namespace", "dotnetName", {
    required: false,
    placeholder: "MyApi",
    help: "The C# namespace and project name (follows the project name until you change it)",
    derive: { from: ["name"], transform: "pascal" },
  }),
  field("description", "Description", "text", { required: false, placeholder: "What it does" }),
];

const GROUPS = [
  { id: "data", name: "Data" },
  { id: "web", name: "Web" },
  { id: "auth", name: "Authentication" },
  { id: "logging", name: "Logging" },
  { id: "validation", name: "Validation" },
  { id: "console", name: "Console" },
];

const nuget = (name, range) => ({ registry: "nuget", name, range });
const WEB = ["webapi", "minimal"];

const efContext = `using Microsoft.EntityFrameworkCore;

namespace {ns}.Data;

/// <summary>The app's database. Add a DbSet&lt;T&gt; per table.</summary>
public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
}
`;

const DEPENDENCIES = [
  {
    id: "efcore-sqlite",
    name: "EF Core + SQLite",
    description: "Entity Framework Core with a SQLite database file, and an AppDbContext.",
    group: "data",
    icon: "SiSqlite",
    docs: "https://learn.microsoft.com/ef/core/",
    appliesTo: WEB,
    conflicts: [{ id: "efcore-postgres", reason: "choose one database provider." }],
    packages: [nuget("Microsoft.EntityFrameworkCore.Sqlite", ">=10.0.0 <11.0.0"), nuget("Microsoft.EntityFrameworkCore.Design", ">=10.0.0 <11.0.0")],
    apply(ctx) {
      ctx.slot("dotnetFiles", ["Data/AppDbContext.cs", efContext]);
      ctx.slot("dotnetUsings", "Microsoft.EntityFrameworkCore");
      ctx.slot("dotnetUsings", `${ctx.details.namespace}.Data`);
      ctx.slot("dotnetServices", 'builder.Services.AddDbContext<AppDbContext>(options =>\n    options.UseSqlite(builder.Configuration.GetConnectionString("Default")));');
      ctx.slot("dotnetSettings", { ConnectionStrings: { Default: "Data Source=app.db" } });
    },
  },
  {
    id: "efcore-postgres",
    name: "EF Core + PostgreSQL",
    description: "Entity Framework Core with Npgsql, and an AppDbContext.",
    group: "data",
    icon: "SiPostgresql",
    docs: "https://www.npgsql.org/efcore/",
    appliesTo: WEB,
    packages: [nuget("Npgsql.EntityFrameworkCore.PostgreSQL", ">=10.0.0 <11.0.0"), nuget("Microsoft.EntityFrameworkCore.Design", ">=10.0.0 <11.0.0")],
    apply(ctx) {
      ctx.slot("dotnetFiles", ["Data/AppDbContext.cs", efContext]);
      ctx.slot("dotnetUsings", "Microsoft.EntityFrameworkCore");
      ctx.slot("dotnetUsings", `${ctx.details.namespace}.Data`);
      ctx.slot("dotnetServices", 'builder.Services.AddDbContext<AppDbContext>(options =>\n    options.UseNpgsql(builder.Configuration.GetConnectionString("Default")));');
      ctx.slot("dotnetSettings", { ConnectionStrings: { Default: "Host=localhost;Database=app;Username=postgres;Password=" } });
    },
  },
  {
    id: "mongodb",
    name: "MongoDB",
    description: "The official MongoDB driver, registered as IMongoClient.",
    group: "data",
    icon: "SiMongodb",
    docs: "https://www.mongodb.com/docs/drivers/csharp/current/",
    appliesTo: WEB,
    packages: [nuget("MongoDB.Driver", ">=3.0.0 <4.0.0")],
    apply(ctx) {
      ctx.slot("dotnetUsings", "MongoDB.Driver");
      ctx.slot("dotnetServices", 'builder.Services.AddSingleton<IMongoClient>(_ =>\n    new MongoClient(builder.Configuration.GetConnectionString("Mongo") ?? "mongodb://localhost:27017"));');
    },
  },
  {
    id: "redis",
    name: "Redis",
    description: "StackExchange.Redis, registered as IConnectionMultiplexer (connects on first use).",
    group: "data",
    icon: "SiRedis",
    docs: "https://stackexchange.github.io/StackExchange.Redis/",
    appliesTo: WEB,
    packages: [nuget("StackExchange.Redis", ">=2.8.0 <4.0.0")],
    apply(ctx) {
      ctx.slot("dotnetUsings", "StackExchange.Redis");
      ctx.slot(
        "dotnetServices",
        'builder.Services.AddSingleton<IConnectionMultiplexer>(_ =>\n    ConnectionMultiplexer.Connect(builder.Configuration.GetConnectionString("Redis") ?? "localhost:6379"));'
      );
    },
  },
  {
    id: "scalar",
    name: "Scalar API reference",
    description: "An interactive API reference for the OpenAPI document, at /scalar in Development.",
    group: "web",
    docs: "https://github.com/scalar/scalar/tree/main/integrations/aspnetcore",
    appliesTo: WEB,
    packages: [nuget("Scalar.AspNetCore", ">=2.0.0 <3.0.0")],
    apply(ctx) {
      ctx.slot("dotnetUsings", "Scalar.AspNetCore");
      ctx.slot("dotnetDevApp", "app.MapScalarApiReference();");
    },
  },
  {
    id: "jwt",
    name: "JWT bearer authentication",
    description: "Accept JSON Web Tokens on protected endpoints ([Authorize]).",
    group: "auth",
    icon: "SiJsonwebtokens",
    docs: "https://learn.microsoft.com/aspnet/core/security/authentication/configure-jwt-bearer-authentication",
    appliesTo: WEB,
    packages: [nuget("Microsoft.AspNetCore.Authentication.JwtBearer", ">=10.0.0 <11.0.0")],
    apply(ctx) {
      ctx.slot("dotnetUsings", "Microsoft.AspNetCore.Authentication.JwtBearer");
      ctx.slot("dotnetServices", "builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();\nbuilder.Services.AddAuthorization();");
      ctx.slot("dotnetApp", "app.UseAuthentication();");
      if (ctx.variant.id === "minimal") ctx.slot("dotnetApp", "app.UseAuthorization();");
    },
  },
  {
    id: "serilog",
    name: "Serilog",
    description: "Structured logging, configured from appsettings.json.",
    group: "logging",
    docs: "https://serilog.net/",
    appliesTo: WEB,
    packages: [nuget("Serilog.AspNetCore", ">=9.0.0 <11.0.0")],
    apply(ctx) {
      ctx.slot("dotnetUsings", "Serilog");
      ctx.slot("dotnetServices", "builder.Services.AddSerilog((services, logger) => logger\n    .ReadFrom.Configuration(builder.Configuration)\n    .WriteTo.Console());");
    },
  },
  {
    id: "fluentvalidation",
    name: "FluentValidation",
    description: "Strongly-typed validation rules for your request models.",
    group: "validation",
    docs: "https://docs.fluentvalidation.net/",
    packages: [nuget("FluentValidation", ">=12.0.0 <13.0.0")],
  },
  {
    id: "spectre",
    name: "Spectre.Console",
    description: "Beautiful console output: colours, tables, prompts.",
    group: "console",
    docs: "https://spectreconsole.net/",
    appliesTo: ["console"],
    packages: [nuget("Spectre.Console", ">=0.50.0 <1.0.0")],
  },
];

const variant = (id, name, description, kind) => ({ id, name, icon: "SiDotnet", description, options: [], details: DETAILS, template: dotnetTemplate(kind) });

export default {
  id: "dotnet",
  name: ".NET",
  icon: "SiDotnet",
  description: "Web APIs and apps in C# on .NET 10.",
  groups: GROUPS,
  variants: [
    variant("webapi", "Web API (controllers)", "ASP.NET Core with controllers and OpenAPI, plus an xUnit test project.", "controllers"),
    variant("minimal", "Minimal API", "ASP.NET Core endpoints in a few lines, plus an xUnit test project.", "minimal"),
    variant("console", "Console app", "A C# console program, plus an xUnit test project.", "console"),
  ],
  dependencies: DEPENDENCIES.map((d) => ({ ...d, appliesTo: d.appliesTo ?? ["webapi", "minimal", "console"] })),
};
