# continuum-directory

Continuum's directory: the one place that says who is who and who may use what,
for the whole Continuum system.

- **Users of every kind** (`users.kind`): human, agent, app, org, department.
  A human's id is their Continuum account's; an organization and each department
  are users too.
- **Continuum roles and features**: a role is a set of features switched on, app
  by app (Console, Directory, Create, Workspaces, Agents, Data, Deploy). Admin is
  only ever the admin role. An organization's roles never give it.
- **Organizations**: members (owner, admin, member, viewer: the organization's own
  roles), departments (which projects each member sees), invites by email.
- **Mappings** (`links`): a user as other systems know them: the Continuum
  account, GitHub, Continuum Deploy's tenant, the brain.
- **Sign-ins and app use**, and what admins changed.

It keeps all of this in **its own Postgres**. Projects, bridges and sign-in
secrets (passwords, GitHub tokens, sessions) stay in Continuum's MongoDB.

## Parts

| Folder | What | Runs as |
| --- | --- | --- |
| `server/` | the directory itself (Node, Postgres via `pg`) | inside continuum-api, mounted at `/directory` (like continuum-data) |
| `app/` | its page: your organizations; for Continuum's admins users, roles, sign-ins, changes, production sync | `continuum-directory-app`, port 45194 |
| (Postgres) | its database | `continuum-directory-db`, port 45193 |

`server/` imports nothing from continuum-api: the host gives it settings, a
logger and hooks (`continuumUser`, `endSessions`, `countProjects`,
`legacyMongo`), mounts `router({ auth })`, and calls `start()` / `stop()`.
It can become a service of its own later without changing its code.

On its first start against an empty database it copies what Continuum kept in
MongoDB before it existed (roles, the default role, each account's role, status,
session version and last sign-in, GitHub links, sign-ins, app use, admin changes,
any organizations). Add-only, one transaction; MongoDB isn't changed.

## Signing in to the page

The page signs in through Continuum, as Continuum Deploy does: OAuth 2.0
authorization code with PKCE. It is a public client (`continuum-directory`, no
secret) of continuum-api's `/oauth`. Its access token (10 minutes, audience
`continuum-directory`) lives in memory; the refresh token in the tab's
sessionStorage. "Sign out everywhere" ends it too. In Continuum, **Admin** in the
profile menu opens it in a new tab; so does the space switcher's
"members and departments".

## Settings

continuum-api (host):

- `DIRECTORY_DATABASE_URL` (required) the Postgres address. Optional: `DIRECTORY_DATABASE_SSL=true`, `DIRECTORY_POOL_SIZE` (10), `DIRECTORY_ACCESS_CACHE_MS` (60000), `LOGIN_HISTORY_DAYS` (180).
- `DIRECTORY_APP_URL` the page's address (its `/callback` is the only return address allowed, and CORS lets it call the API). `DIRECTORY_REDIRECT_URIS` overrides the return addresses.
- `DIRECTORY_MODULE` where `server/src/index.js` is, when mounted elsewhere (Docker Compose).
- `OAUTH_SIGNING_KEY` (already there for Deploy) signs its tokens.

continuum-directory-app: `VITE_API_BASE_URL` (continuum-api), `VITE_CONTINUUM_URL` (Continuum's page).
continuum-bridge-spine: `VITE_DIRECTORY_URL` (this page; unset: no link).

## Local

`docker/docker-compose.yml` runs `continuum-directory-db` (Postgres 16 on
127.0.0.1:45193, a development password) and `continuum-directory-app` on
http://localhost:45194; continuum-api mounts `server/`.

Tests: `cd server && PG_TEST_URL=postgres://… npm test` (a throwaway database:
its tables are dropped first).

## Cloud

- continuum-api's `Dockerfile.cloud` installs and copies `server/`.
- `continuum.deploy.json` has `continuum-directory-app` (port 45194).
- In Continuum Deploy: a Postgres server (`continuum-directory-db`) with a
  `directory` database read by continuum-api as `DIRECTORY_DATABASE_URL`, and the
  host `directory.<domain>` for continuum-directory-app. continuum-api needs the
  database before it's rolled out: it doesn't start without it.
