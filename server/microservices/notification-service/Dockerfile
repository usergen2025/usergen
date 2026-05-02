FROM node:18-alpine AS base
FROM base AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache libc6-compat
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/package*.json ./
COPY --from=builder --chown=nestjs:nodejs /app/prisma ./prisma
RUN mkdir -p logs && chown nestjs:nodejs logs
USER nestjs
EXPOSE 9006
ENV PORT=9006
ENV SERVICE_NAME=notification-service
CMD ["node", "dist/main.js"]
