FROM node:18-alpine AS base
# Install FFmpeg, FFprobe, util-linux (for nice/ionice), and Python (for background removal script)
RUN apk add --no-cache ffmpeg ffprobe util-linux python3 py3-pip
# Install Python dependencies for background removal script
RUN pip3 install --no-cache-dir rembg opencv-python pillow numpy onnxruntime
FROM base AS deps
RUN apk add --no-cache libc6-compat
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
EXPOSE 9004
ENV PORT=9004
ENV SERVICE_NAME=video-processing-service
CMD ["node", "dist/main.js"]

