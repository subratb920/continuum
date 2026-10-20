# continuum-site

Continuum's public website at **https://www.continuum-console.one** (the plain domain is forwarded to it): what Continuum is and is becoming, as plain HTML pages that search engines and link previews read without JavaScript. Continuum itself stays at `app.continuum-console.one`.

- `src/menu.mjs`: the menu bar's groups (Platform, Solutions, Data & AI, Teams), a few words and an icon per topic, and the logo (bridge-spine's BrandMark as SVG).
- `src/pages.mjs`: every page's content: one search topic per page (title ≤ 60 characters, description ≤ 160, one h1, sections, questions).
- `build.mjs`: makes `dist/`: each page with its canonical address, Open Graph and Twitter cards, structured data (Organization, WebSite, SoftwareApplication, BreadcrumbList, FAQPage), plus `sitemap.xml`, `robots.txt` and a real 404.
- `server.mjs`: serves `dist/` on port 45195: clean addresses (`/ai-ide`), the domain's other name (plain or www.) → SITE_URL (301), gzip, security headers.
- `static/site.js`: the motion: headline words rising, cards arriving with columns at different speeds, a statement lighting up word by word, "Continuum for …" changing one phrase at a time in one place, the topics standing still by theme and lighting up in reading order as you scroll, "Everything Continuum does" as a workflow run: the topics as steps on one winding path, one dot travelling it as you scroll (eased) and opening each step it reaches; on phones a line down the list that fills as you go, a light and tilt under the cursor. Pages read the same without it, and reduced motion keeps everything still.
- `static/`: styles, icons and `og.png` (the link-preview picture; `npm run og` redraws it from `scripts/og.html`).

No dependencies. Settings: `SITE_URL` (default `https://www.continuum-console.one`), `APP_URL` (default `https://app.continuum-console.one`), `PORT` (45195).

## Run

- `npm test`: builds, then checks titles, descriptions, links, structured data, sitemap and the server.
- `npm start`: http://localhost:45195
- Docker Compose: `continuum-site-app` in `docker/docker-compose.yml`.
- Cloud: app `continuum-site-app` in `continuum.deploy.json`, with the address `www` in Deploy.

## Adding a page

Add an entry to `PAGES` in `src/pages.mjs`, run `npm test`. The sitemap, menus, footer and "Explore" lists pick it up.
After deploying, submit `https://www.continuum-console.one/sitemap.xml` in Google Search Console and Bing Webmaster Tools.
