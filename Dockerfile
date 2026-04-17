FROM node:22-slim

# Install ffmpeg for last-frame extraction
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install all dependencies (need devDeps for build)
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

# Copy source
COPY . .

# Vite needs these at build time for the frontend bundle.
# Anon key is public (safe to embed — it's the equivalent of a public API key).
ENV VITE_SUPABASE_URL=https://hpyxkrhfyrfmuospnqxu.supabase.co
ENV VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhweXhrcmhmeXJmbXVvc3BucXh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5OTU0OTIsImV4cCI6MjA3NzU3MTQ5Mn0.l4fiqR67F2RD_GvE899HgA3LOt3F0S0-yO-gas8pjt8

# Build frontend
RUN npm run build

# Prune dev dependencies
RUN npm prune --omit=dev --legacy-peer-deps

# Create storage directories
RUN mkdir -p storage/audio storage/images storage/videos

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

CMD ["npm", "start"]
