FROM node:22-slim
WORKDIR /app

RUN corepack enable pnpm

# Install from workspace root so lockfile and workspace protocol resolve correctly
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/package.json
RUN pnpm install --frozen-lockfile

COPY frontend ./frontend

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter frontend build

EXPOSE 3000
CMD ["pnpm", "--filter", "frontend", "start"]
