FROM python:3.12-slim-bookworm

RUN adduser --disabled-password --gecos "" vizer

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app

COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-install-project

COPY backend/vizer/ vizer/
COPY backend/emotes/ emotes/
COPY backend/main.py ./

RUN mkdir -p /data && chown -R vizer:vizer /app /data

USER vizer

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/')"

CMD ["uv", "run", "twitch-vizer"]
