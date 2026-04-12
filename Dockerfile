FROM node:22-slim

# Install ffmpeg for last-frame extraction
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install all dependencies (need devDeps for build)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

# Build frontend
RUN npm run build

# Prune dev dependencies
RUN npm prune --omit=dev

# Create storage directories
RUN mkdir -p storage/audio storage/images storage/videos

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

CMD ["npm", "start"]
