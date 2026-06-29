FROM node:22-slim
WORKDIR /app

RUN corepack enable pnpm

# Install from workspace root so lockfile and workspace protocol resolve correctly
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/package.json
RUN pnpm install --frozen-lockfile

COPY frontend ./frontend

# Railway passes Variables as Docker build args — declare them here so
# Next.js can bake NEXT_PUBLIC_* values into the bundle at build time
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SHOPIFY_API_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SHOPIFY_API_KEY=$NEXT_PUBLIC_SHOPIFY_API_KEY

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter frontend build

EXPOSE 3000
CMD ["pnpm", "--filter", "frontend", "start"]
