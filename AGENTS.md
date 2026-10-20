# Continuum

Continuum: projects, bridges (work sessions), goals, its brain's agents, Workspaces and Deploy links.
Plain JavaScript (ES modules), Node 22. Each folder is its own app.

## Folders
- `continuum-api/` Express API (MongoDB), port 45170. Routes: `src/<area>/routes.js`. Tests: `test/*.test.js`.
- `continuum-bridge-spine/` the web UI (React + Vite), port 45173. API calls: `src/api.js`; brain: `src/brain/`; screens: `src/screens/`.
- `continuum-data/` data engine (sources, datasets, pipelines), mounted into continuum-api at `/data`.
- `continuum-directory/` Continuum Directory: `server/` (users of every kind, roles and features, organizations, departments, sign-ins; its own Postgres) mounted into continuum-api at `/directory`, and `app/` (continuum-directory-app, port 45194) its own page, signed in through Continuum. Ports stay in 45170–45199.
- `continuum-workspaces/` development servers per project (OpenVSCode Server).
- `continuum-site/` the public website (continuum-site-app, port 45195): plain HTML from `src/pages.mjs`, for search engines; no dependencies. Check: `npm test` there.
- `continuum-create/` the project generator (Backstage, yarn): leave it alone unless the task is about it.
- `docker/` the local stack (docker-compose).

## Checks (run the ones for what you changed)
- API: `cd continuum-api && npm test`
- Data / Workspaces: `npm test` in that folder
- UI: `cd continuum-bridge-spine && npx vite build && npx eslint <changed files>`

## Rules
- API errors: `throw new AppError(message, status, CODE)`; never answer errors by hand.
- Every route acts only for the signed-in user (`req.user`); never return another user's data.
- UI text is plain and short, in the user's words; no jargon.
- Match the surrounding code: its comments, naming and style.
- Never read or write `.env` files, keys or tokens.
