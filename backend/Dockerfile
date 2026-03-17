FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install backend deps first for layer caching
COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm ci --omit=dev

# Install frontend deps (include dev for vite) and build
COPY frontend/package.json frontend/package-lock.json* ./frontend/
RUN cd frontend && npm ci --include=dev
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# Copy backend source and landing
COPY backend/ ./backend/
COPY landing/ ./landing/

# Create data + uploads dirs
RUN mkdir -p backend/data backend/uploads/projects

EXPOSE 3001

WORKDIR /app/backend

CMD ["node", "server.js"]
