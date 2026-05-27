# dev: next dev with source mounted as volume.
# node_modules are installed in the image so Linux-native binaries (e.g.
# lightningcss) are present. web_root_node_modules and web_node_modules
# Docker volumes shadow the host bind-mount paths and are initialised from
# these image layers on first start — no cross-platform binary mismatch even
# after down -v.
FROM node:20-slim AS dev
WORKDIR /workspace
COPY package*.json ./
COPY web/package*.json ./web/
COPY openapi/client/package*.json ./openapi/client/
RUN npm ci --workspaces
WORKDIR /workspace/web
CMD ["npm", "run", "dev"]

# builder: production build (requires repo root as build context)
FROM node:20-alpine AS builder
WORKDIR /workspace
COPY package*.json ./
COPY web/package*.json ./web/
COPY openapi/client/package*.json ./openapi/client/
RUN npm ci --workspaces
COPY web/ ./web/
COPY openapi/client/ ./openapi/client/
WORKDIR /workspace/web
RUN npm run build

# prod: minimal Next.js server
FROM node:20-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /workspace/web/.next/standalone ./
COPY --from=builder /workspace/web/.next/static ./.next/static
COPY --from=builder /workspace/web/public ./public
CMD ["node", "server.js"]
