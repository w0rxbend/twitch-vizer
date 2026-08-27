# twitch-vizer

twitch-vizer is a self-hosted Twitch visual overlay system for OBS. A Python
backend listens to Twitch EventSub chat and channel events, converts them into
visual events, and broadcasts those events over WebSocket. A Vite/TypeScript
frontend provides browser-source scenes that render chat, emotes, emoji,
follows, subscriptions, cheers, raids, and gift subscriptions.

## Features

- TwitchIO `AutoBot` integration with EventSub WebSocket subscriptions.
- Starlette + uvicorn server with a `/ws` broadcast endpoint.
- OBS browser-source scenes built with TypeScript, Vite, and PixiJS.
- Chat message payloads with text fragments, Twitch emote URLs, Unicode emoji
  image parts, user avatars, stable per-user colors, and deterministic seeds.
- System event overlays for follows, subs, resubs, gift subs, cheers, and raids.
- Optional local emote cache from `backend/emotes/emotes.db` or
  `backend/emotes/all_emotes.json`.
- Docker image that builds frontend scenes and serves them from the backend.

## Requirements

- Python 3.12+
- uv
- Node.js 22+ and npm
- Twitch application credentials and bot OAuth tokens
- OBS Studio with browser sources

## Configuration

Create a local environment file:

```bash
cp .env.example .env
```

Required values:

```dotenv
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
TWITCH_ACCESS_TOKEN=
TWITCH_REFRESH_TOKEN=
TWITCH_BOT_USERNAME=
```

Optional values:

```dotenv
VIZER_SERVER_HOST=127.0.0.1
VIZER_SERVER_PORT=8080
VIZER_LOG_LEVEL=INFO
VIZER_TOKEN_FILE=.tio.tokens.json
```

The Twitch bot username is resolved to a Twitch user ID at startup. The server
binds to `127.0.0.1:8080` by default; the overlay endpoints have no
authentication, so set `VIZER_SERVER_HOST=0.0.0.0` only when the server should
be reachable from other machines (the Docker setup does this explicitly).
`VIZER_TOKEN_FILE` controls where twitchio persists refreshed OAuth tokens; the
Docker image points it at `/data/.tio.tokens.json` so tokens survive
redeploys via the mounted `./data` volume. `VIZER_EMOTES_DB_PATH` can also be
set when you need a non-default emote cache location; otherwise the backend
uses `backend/emotes/emotes.db` in local development.

## Local Development

Install frontend dependencies from the project root:

```bash
npm install
```

Install backend dependencies:

```bash
cd backend
uv sync
```

Run the backend:

```bash
cd backend
uv run twitch-vizer
```

Run the frontend dev server from the project root:

```bash
npm run dev
```

Vite serves scene pages from `frontend/src/scenes` and proxies `/ws` to the
backend at `ws://localhost:8080`.

## OBS Browser Sources

During frontend development, use Vite URLs such as:

```text
http://localhost:5173/hacker-chat/
http://localhost:5173/chat/
http://localhost:5173/emoji-chat/
http://localhost:5173/fluid-chat/
http://localhost:5173/glitch-overlay/
http://localhost:5173/grunge/
http://localhost:5173/mr-robot/
http://localhost:5173/pixel-chat/
http://localhost:5173/silicon-valley/
```

In the Docker or production-style build, frontend scenes are copied into the
backend image and served by the Python server:

```text
http://localhost:8080/scenes/hacker-chat/
http://localhost:8080/scenes/chat/
```

The backend index at `http://localhost:8080/` returns JSON with the WebSocket
path and any built scene names available under `vizer/static/scenes`.

## Docker

Run the published image with one command (reads `.env` via `env_file`):

```bash
cp .env.example .env   # first time only; fill in the Twitch credentials
docker compose up -d
```

To build the image from local sources instead of pulling it, add the build
override file:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

The Compose service publishes `8080:8080`, reads `.env`, and mounts `./data` to
`/data` for runtime persistence. The base `docker-compose.yml` stays pull-only
because CI copies it to the deploy server, where no source tree exists to build
from; `docker-compose.build.yml` adds the local `build:` section on top of it.

The published image is multi-architecture: CI builds and pushes both
`linux/amd64` and `linux/arm64`, so `docker compose up -d` pulls the right
variant automatically on either architecture. For a local cross-build, set
`DOCKER_PLATFORM` (for example `DOCKER_PLATFORM=linux/arm64`) before running
the build command above; cross-building on a non-arm host requires binfmt/QEMU
(`docker run --privileged --rm tonistiigi/binfmt --install arm64`).

## Project Layout

```text
backend/vizer/config.py       environment loading and validation
backend/vizer/runtime.py      composition root
backend/vizer/bot.py          TwitchIO adapter and EventSub event mapping
backend/vizer/handler.py      visual event factory, emote resolution, queue processing
backend/vizer/server.py       Starlette HTTP and WebSocket server
backend/vizer/emote_urls.py   shared Twitch emote CDN URL helpers
backend/tests/                backend unit tests
frontend/src/shared/          shared browser overlay utilities
frontend/src/scenes/          OBS browser-source scene pages
Dockerfile                    frontend build plus Python runtime image
docker-compose.yml            local container runtime
```

## Testing And Checks

Backend tests:

```bash
cd backend
uv run pytest
```

Backend lint/type checks:

```bash
cd backend
uv run ruff check .
uv run ruff format --check .
uv run pyright
```

Frontend build:

```bash
npm run build
```

## Event Flow

```text
Twitch EventSub
      |
      v
VizBot
      |
      v
asyncio.Queue[QueuedMessage]
      |
      v
MessageHandler
      |
      v
VizServer.broadcast()
      |
      v
OBS browser-source scene over WebSocket
```

The browser scenes consume JSON `VisualEvent` payloads. Chat events use
`event="chat_message"`; channel events use names such as `follow`, `sub`,
`cheer`, `raid`, and `gift_sub`.
