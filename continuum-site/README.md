# continuum-site

Continuum's public website at **https://continuum-console.one**: what Continuum is and is becoming, as plain HTML pages that search engines and link previews read without JavaScript. Continuum itself stays at `app.continuum-console.one`.

- `src/pages.mjs`: every page's content: one search topic per page (title ≤ 60 characters, description ≤ 160, one h1, sections, questions).
- `build.mjs`: makes `dist/`: each page with its canonical address, Open Graph and Twitter cards, structured data (Organization, WebSite, SoftwareApplication, BreadcrumbList, FAQPage), plus `sitemap.xml`, `robots.txt` and a real 404.
- `server.mjs`: serves `dist/` on port 45195: clean addresses (`/ai-ide`), `www.` → the plain domain (301), gzip, security headers.
- `static/site.js`: the motion: headline words rising, cards arriving with columns at different speeds, a statement lighting up word by word, "Continuum for …" changing one phrase at a time in one place, the topics standing still by theme and lighting up in reading order as you scroll, the topics rail gliding sideways (eased) as you scroll, a light and tilt under the cursor. Pages read the same without it, and reduced motion keeps everything still.
- `static/`: styles, icons and `og.png` (the link-preview picture; `npm run og` redraws it from `scripts/og.html`).

No dependencies. Settings: `SITE_URL` (default `https://continuum-console.one`), `APP_URL` (default `https://app.continuum-console.one`), `PORT` (45195).

## Run

- `npm test`: builds, then checks titles, descriptions, links, structured data, sitemap and the server.
- `npm start`: http://localhost:45195
- Docker Compose: `continuum-site-app` in `docker/docker-compose.yml`.
- Cloud: app `continuum-site-app` in `continuum.deploy.json`, served on the plain domain and `www.`.

## Adding a page

Add an entry to `PAGES` in `src/pages.mjs`, run `npm test`. The sitemap, menus, footer and "Explore" lists pick it up.
After deploying, submit `https://continuum-console.one/sitemap.xml` in Google Search Console and Bing Webmaster Tools.
