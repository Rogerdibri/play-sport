FROM node:26-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
COPY packages/shared/package.json packages/shared/
RUN npm ci -w @playsport/shared -w @playsport/api -w @playsport/web --include-workspace-root

COPY . .
RUN npm run build

ENV NODE_ENV=production PLAYSPORT_DATA_DIR=/data
EXPOSE 3000
CMD ["node", "scripts/start-production.mjs"]
