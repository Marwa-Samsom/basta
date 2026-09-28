FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

FROM base AS build
# NEXT_PUBLIC_* تُخبَز في حزمة المتصفّح وقت البناء — تمريرها وقت التشغيل لا أثر له.
# docker build --build-arg NEXT_PUBLIC_API_URL=https://api.example.com/api/v1 \
#              --build-arg NEXT_PUBLIC_SITE_URL=https://example.com -f apps/web/Dockerfile .
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SITE_URL
# عنوان غائب أو محلي يعني موقع إنتاج يرسل طلباته إلى جهاز الزائر — يُرفض هنا لا بعد النشر
RUN case "$NEXT_PUBLIC_API_URL" in \
      "") echo "NEXT_PUBLIC_API_URL مطلوب: --build-arg NEXT_PUBLIC_API_URL=https://…" >&2; exit 1 ;; \
      *127.0.0.1*|*localhost*|*0.0.0.0*) echo "NEXT_PUBLIC_API_URL يشير إلى عنوان محلي: $NEXT_PUBLIC_API_URL" >&2; exit 1 ;; \
    esac; \
    [ -n "$NEXT_PUBLIC_SITE_URL" ] || { echo "NEXT_PUBLIC_SITE_URL مطلوب: --build-arg NEXT_PUBLIC_SITE_URL=https://…" >&2; exit 1; }
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1
# السياق هو جذر المستودع — .dockerignore يُبقي خارجه .env والقاعدة المحلية ووثائق البائعين
COPY . .
RUN npm ci
RUN npm run build -w @basta/web

FROM base AS runtime
ENV NODE_ENV=production TZ=UTC NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
