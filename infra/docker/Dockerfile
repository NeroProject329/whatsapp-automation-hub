
FROM node:24-bookworm-slim AS build
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates git && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@11.18.0
COPY . .
RUN pnpm install --frozen-lockfile && pnpm db:generate && pnpm build
ENV NODE_ENV=production
USER node

FROM build AS api
WORKDIR /repo
CMD ["node","apps/api/dist/main.js"]

FROM build AS worker
WORKDIR /repo
CMD ["node","apps/worker/dist/main.js"]

FROM build AS web
WORKDIR /repo
CMD ["node","apps/web/node_modules/next/dist/bin/next","start","apps/web","-H","0.0.0.0","-p","3000"]
