# ---- builder ----
FROM node:22-slim AS builder
WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml pnpm.json ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm prisma generate
RUN pnpm build

# ---- runner ----
FROM node:22-slim AS runner
WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

COPY prisma ./prisma
COPY prisma.config.ts ./
COPY package.json ./
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

ENV NODE_ENV=production
EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
