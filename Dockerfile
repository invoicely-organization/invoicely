# The image of the api (ADR-013 Хостинг, данни и операции), built from the root of the monorepo (dockerContext: .).
# The start command is the CMD, not the ENTRYPOINT: the worker will run the same image with `node dist/worker.js`.

FROM node:22-slim AS build
# pnpm comes from corepack, at the version pinned in package.json "packageManager".
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @invoicely/api build
# Keep only the production dependencies for the runtime image.
RUN CI=true pnpm install --frozen-lockfile --prod --offline

FROM node:22-slim AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /repo /repo
USER node
WORKDIR /repo/apps/api
# Render gives the port in PORT; apps/api/src/main.ts listens on it.
CMD ["node", "dist/main.js"]
