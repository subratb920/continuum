// src/create/templates/dotnet.js
//
// .NET 10: ASP.NET Core Web API (controllers), Minimal API and a console app,
// as `dotnet new webapi|console` make them (see NOTICE), each with an xUnit
// test project and a solution (.slnx). Packages are written into the .csproj
// files at their newest versions (NuGet). Slots: dotnetUsings, dotnetServices
// (builder.Services…), dotnetApp (app.Use…/Map…), dotnetSettings (extra
// appsettings.json sections), dotnetFiles (relative to the app's folder).

const TFM = "net10.0";

const csString = (s) => JSON.stringify(String(s)); // a C# string literal ("..." with escapes)

export const DOTNET_GITIGNORE = `## .NET build output
[Bb]in/
[Oo]bj/
[Ll]og/
[Ll]ogs/
artifacts/

## Visual Studio, Rider, VS Code
.vs/
.idea/
*.user
*.suo
*.userosscache
*.sln.docstates
.vscode/*
!.vscode/extensions.json

## Tests
TestResults/
*.trx
coverage*.json
coverage*.xml

## NuGet
*.nupkg
*.snupkg
**/packages/*

## Local data and secrets (keep .env.example)
*.db
*.db-shm
*.db-wal
.env
.env.*
!.env.example
appsettings.*.local.json

## OS
.DS_Store
Thumbs.db
`;

function csproj({ sdk, props, packages, references = [] }) {
  const lines = [`<Project Sdk="${sdk}">`, "", "  <PropertyGroup>", ...props.map(([k, v]) => `    <${k}>${v}</${k}>`), "  </PropertyGroup>"];
  if (packages.length) {
    lines.push("", "  <ItemGroup>", ...packages.map(([name, version]) => `    <PackageReference Include="${name}" Version="${version}" />`), "  </ItemGroup>");
  }
  if (references.length) {
    lines.push("", "  <ItemGroup>", ...references.map((r) => `    <ProjectReference Include="${r}" />`), "  </ItemGroup>");
  }
  return `${lines.join("\n")}\n\n</Project>\n`;
}

const appSettings = (extra) =>
  `${JSON.stringify({ Logging: { LogLevel: { Default: "Information", "Microsoft.AspNetCore": "Warning" } }, AllowedHosts: "*", ...extra }, null, 2)}\n`;

const launchSettings = (port) =>
  `${JSON.stringify(
    {
      $schema: "https://json.schemastore.org/launchsettings.json",
      profiles: {
        http: {
          commandName: "Project",
          dotnetRunMessages: true,
          launchBrowser: false,
          applicationUrl: `http://localhost:${port}`,
          environmentVariables: { ASPNETCORE_ENVIRONMENT: "Development" },
        },
      },
    },
    null,
    2
  )}\n`;

export function dotnetTemplate(kind) {
  const web = kind !== "console";
  return {
    manifest: "nuget",
    prepare(ctx) {
      const ns = ctx.details.namespace;
      ctx.meta.appDir = `src/${ns}`;
      if (web) ctx.pkg("nuget", "Microsoft.AspNetCore.OpenApi", ">=10.0.0 <11.0.0");
      // Test project (dev): xUnit as `dotnet new xunit` sets it up
      for (const [name, range] of [
        ["coverlet.collector", ">=6.0.0 <7.0.0"],
        ["Microsoft.NET.Test.Sdk", ">=17.14.0 <18.0.0"],
        ["xunit", ">=2.9.0 <3.0.0"],
        ["xunit.runner.visualstudio", ">=3.1.0 <4.0.0"],
        ...(web ? [["Microsoft.AspNetCore.Mvc.Testing", ">=10.0.0 <11.0.0"]] : []),
      ]) {
        ctx.pkg("nuget", name, range, { dev: true });
      }
    },
    build(ctx) {
      const ns = ctx.details.namespace;
      const app = `src/${ns}`;
      const tests = `tests/${ns}.Tests`;
      const usings = [...new Set(ctx.slots.dotnetUsings ?? [])].sort();
      const services = ctx.slots.dotnetServices ?? [];
      const pipeline = ctx.slots.dotnetApp ?? [];
      const port = 5000 + (ns.length * 37) % 900;

      ctx.add(".gitignore", DOTNET_GITIGNORE);
      ctx.add(`${ctx.details.name}.slnx`, `<Solution>\n  <Folder Name="/src/">\n    <Project Path="${app}/${ns}.csproj" />\n  </Folder>\n  <Folder Name="/tests/">\n    <Project Path="${tests}/${ns}.Tests.csproj" />\n  </Folder>\n</Solution>\n`);
      for (const [path, contents] of ctx.slots.dotnetFiles ?? []) ctx.add(`${app}/${path}`, contents.replaceAll("{ns}", ns));

      if (web) {
        const settings = Object.assign({}, ...(ctx.slots.dotnetSettings ?? []));
        ctx.add(`${app}/appsettings.json`, appSettings(settings));
        ctx.add(`${app}/appsettings.Development.json`, `${JSON.stringify({ Logging: { LogLevel: { Default: "Information", "Microsoft.AspNetCore": "Warning" } } }, null, 2)}\n`);
        ctx.add(`${app}/Properties/launchSettings.json`, launchSettings(port));
        const controllers = kind === "controllers";
        ctx.add(
          `${app}/Program.cs`,
          `${usings.map((u) => `using ${u};\n`).join("")}${usings.length ? "\n" : ""}var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
${controllers ? "builder.Services.AddControllers();\n" : ""}// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();
${services.map((s) => `${s}\n`).join("")}
var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();${(ctx.slots.dotnetDevApp ?? []).map((l) => `\n    ${l}`).join("")}
}

app.UseHttpsRedirection();
${pipeline.map((p) => `${p}\n`).join("")}${
            controllers
              ? "app.UseAuthorization();\n\napp.MapControllers();\n"
              : `\napp.MapGet("/", () => new { name = ${csString(ctx.details.name)}, message = "Hello from ASP.NET Core" })
    .WithName("GetRoot");

app.MapGet("/health", () => new { status = "ok" })
    .WithName("GetHealth");
`
          }
app.Run();

// Lets the tests start the app (WebApplicationFactory<Program>)
public partial class Program { }
`
        );
        if (controllers) {
          ctx.add(
            `${app}/Controllers/HelloController.cs`,
            `using Microsoft.AspNetCore.Mvc;

namespace ${ns}.Controllers;

[ApiController]
[Route("")]
public class HelloController : ControllerBase
{
    [HttpGet(Name = "GetRoot")]
    public IActionResult Get() => Ok(new { name = ${csString(ctx.details.name)}, message = "Hello from ASP.NET Core" });

    [HttpGet("health", Name = "GetHealth")]
    public IActionResult Health() => Ok(new { status = "ok" });
}
`
          );
        }
        ctx.add(`${app}/${ns}.http`, `@${ns}_HostAddress = http://localhost:${port}\n\nGET {{${ns}_HostAddress}}/health\nAccept: application/json\n\n###\n`);
        ctx.add(
          `${tests}/HealthTests.cs`,
          `using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;

namespace ${ns}.Tests;

public class HealthTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task Health_answers_ok()
    {
        var client = factory.CreateClient();

        var response = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("\\"status\\":\\"ok\\"", await response.Content.ReadAsStringAsync());
    }
}
`
        );
      } else {
        ctx.add(
          `${app}/Program.cs`,
          `${usings.map((u) => `using ${u};\n`).join("")}${usings.length ? "\n" : ""}using ${ns};

Console.WriteLine(Greeter.Greet(${csString(ctx.details.name)}));
`
        );
        ctx.add(`${app}/Greeter.cs`, `namespace ${ns};\n\npublic static class Greeter\n{\n    public static string Greet(string name) => $"Hello from {name}!";\n}\n`);
        ctx.add(
          `${tests}/GreeterTests.cs`,
          `namespace ${ns}.Tests;

public class GreeterTests
{
    [Fact]
    public void Greets_by_name()
    {
        Assert.Equal("Hello from you!", Greeter.Greet("you"));
    }
}
`
        );
      }

      ctx.readme.setup.push(web ? `dotnet run --project ${app}` : `dotnet run --project ${app}`);
      ctx.readme.notes.push(
        ...(web ? [`Open http://localhost:${port}/health (the OpenAPI document is at /openapi/v1.json in Development).`] : []),
        "- `dotnet test` runs the tests; `dotnet build` builds everything.",
        "Requires the .NET 10 SDK."
      );
    },
    /** The .csproj files, with each package at its resolved version */
    finish(ctx, versions) {
      const ns = ctx.details.namespace;
      const packages = (dev) =>
        [...ctx.packages.nuget]
          .filter(([, p]) => p.dev === dev)
          .map(([name]) => [name, versions.nuget.get(name)?.version ?? "*"])
          .sort(([a], [b]) => a.localeCompare(b));
      ctx.add(
        `src/${ns}/${ns}.csproj`,
        csproj({
          sdk: web ? "Microsoft.NET.Sdk.Web" : "Microsoft.NET.Sdk",
          props: [...(web ? [] : [["OutputType", "Exe"]]), ["TargetFramework", TFM], ["Nullable", "enable"], ["ImplicitUsings", "enable"], ["RootNamespace", ns]],
          packages: packages(false),
        })
      );
      ctx.add(
        `tests/${ns}.Tests/${ns}.Tests.csproj`,
        csproj({
          sdk: "Microsoft.NET.Sdk",
          props: [["TargetFramework", TFM], ["ImplicitUsings", "enable"], ["Nullable", "enable"], ["IsPackable", "false"]],
          packages: packages(true),
          references: [`../../src/${ns}/${ns}.csproj`],
        }).replace("\n</Project>", `\n  <ItemGroup>\n    <Using Include="Xunit" />\n  </ItemGroup>\n\n</Project>`)
      );
    },
  };
}
