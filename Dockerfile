# Stage 1 — build the frontend (TypeScript → bundled scenes)
FROM node:22-alpine AS frontend-builder

WORKDIR /build

COPY package.json ./
COPY frontend/package.json ./frontend/
RUN npm install --workspace=frontend

COPY frontend/ ./frontend/
RUN npm run build --workspace=frontend

# Stage 2 — Python runtime
FROM python:3.12-slim-bookworm

RUN adduser --disabled-password --gecos "" vizer

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app

COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-install-project

COPY backend/vizer/ vizer/
COPY backend/main.py ./

# Copy Vite-built scene assets (outDir was ../backend/vizer/static/scenes relative to frontend/)
COPY --from=frontend-builder /build/backend/vizer/static/scenes/ vizer/static/scenes/

RUN mkdir -p /data && chown -R vizer:vizer /app /data

USER vizer

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/')"

CMD ["uv", "run", "twitch-vizer"]
