FROM node:18-alpine AS base
# Install FFmpeg and FFprobe for audio conversion (needed in all stages)
RUN apk add --no-cache ffmpeg ffprobe libc6-compat
FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
FROM base AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/package*.json ./
RUN mkdir -p logs && chown nestjs:nodejs logs
USER nestjs
EXPOSE 9002
ENV PORT=9002
ENV SERVICE_NAME=voice-audio-service
CMD ["node", "dist/main.js"]

