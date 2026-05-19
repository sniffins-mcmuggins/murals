# dev: next dev with source mounted as volume (Next.js installed in E7.1)
FROM node:20-alpine AS dev
WORKDIR /app
CMD ["sh", "-c", "echo 'web: placeholder until E7.1' && sleep infinity"]

# builder: production build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# prod: minimal Next.js server
FROM node:20-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
CMD ["node", "server.js"]
