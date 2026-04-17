FROM node:22-slim

# Install ffmpeg for last-frame extraction
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install all dependencies (need devDeps for build)
COPY package.json package-lock.json ./
RUN rm -f package-lock.json && npm install --legacy-peer-deps

# Copy source
COPY . .

# Vite needs these at build time for the frontend bundle
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

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
