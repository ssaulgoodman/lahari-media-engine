# Based on https://www.remotion.dev/docs/docker — Chromium + ffmpeg + Node.
FROM node:22-bookworm-slim

# Install Chromium runtime libs (Remotion uses headless Chromium for rendering)
# and ffmpeg for the encode pass.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ffmpeg \
      ca-certificates \
      fonts-liberation \
      libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxrandr2 libgbm1 libxss1 \
      libasound2 libnspr4 libpangocairo-1.0-0 libcups2 \
      libxshmfence1 libglib2.0-0 libgtk-3-0 \
      wget xdg-utils && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first for better Docker layer caching.
COPY package.json package-lock.json* .npmrc ./
RUN npm ci --legacy-peer-deps

# Source — includes the synced timeline files. Run `npm run sync-timeline`
# locally before building if you've changed the upstream editor.
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src

# Download the Chrome Headless Shell binary that Remotion expects. Doing this
# at build time means the first request isn't slowed by a 100MB download.
RUN npx remotion browser ensure

ENV NODE_ENV=production
ENV PORT=3030
ENV RUN_BOOT_BENCHMARK=1
EXPOSE 3030

CMD ["npm", "start"]
