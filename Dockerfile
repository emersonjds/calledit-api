# Called It API — build & run in one image.
FROM node:22-alpine
WORKDIR /app
RUN corepack enable

# install deps (native optional builds are skipped — not needed at runtime)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

# copy the source, compile TypeScript -> dist, keep the SQL schema next to the migration
COPY . .
RUN pnpm build && cp src/db/schema.sql dist/db/schema.sql

ENV NODE_ENV=production
EXPOSE 3000

# apply the schema, then start the API (compiled JS — no tsx/esbuild at runtime)
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/server.js"]
