FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl

FROM base AS deps
COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/
RUN npm ci --omit=dev --workspace @basta/api || npm install --omit=dev

FROM base AS build
COPY . .
RUN npm ci
RUN npm run db:generate -w @basta/api
RUN npm run build -w @basta/api

FROM base AS runtime
ENV NODE_ENV=production TZ=UTC
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
