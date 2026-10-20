# continuum-site-app: Continuum's public website (port 45195, locally and in the cloud).
# Plain HTML built at start from this container's SITE_URL and APP_URL; no packages to install.
FROM node:20-alpine

WORKDIR /app
COPY --chown=node:node . .
RUN chown node:node /app

EXPOSE 45195
USER node
CMD ["node", "-e", "await import('./build.mjs').then((m) => m.build()); await import('./server.mjs').then((m) => m.server.listen(Number(process.env.PORT) || 45195))"]
