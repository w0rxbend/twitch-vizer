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
- Twitch application credentials (client ID and secret)
- OBS Studio with browser sources

## Configuration

Create a local environment file:

```bash
cp .env.example .env
```

Required values — the credentials of your Twitch application from the
[developer console](https://dev.twitch.tv/console/apps):

```dotenv
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
```

The application registered in the developer console must list
`http://localhost:4343/oauth/callback` as an OAuth redirect URL, exactly as
written (Twitch allows plain `http` only for localhost). Twitch sends the
browser back to this URL after the first-run authorization described below.

Optional values:

```dotenv
VIZER_SERVER_HOST=127.0.0.1
VIZER_SERVER_PORT=8080
VIZER_OAUTH_HOST=localhost
VIZER_OAUTH_PORT=4343
OAUTH_REDIRECT_URL=http://localhost:4343/oauth/callback
VIZER_LOG_LEVEL=INFO
VIZER_TOKEN_FILE=.tio.tokens.json
```

The server binds to `127.0.0.1:8080` by default; the overlay endpoints have no
authentication, so set `VIZER_SERVER_HOST=0.0.0.0` only when the server should
be reachable from other machines (the Docker setup does this explicitly).
`VIZER_OAUTH_HOST`/`VIZER_OAUTH_PORT` control where the OAuth callback server
listens; changing the port changes the redirect URL you must register with
Twitch. `OAUTH_REDIRECT_URL` overrides the full registered redirect URL
for deployments that expose the callback through a domain or reverse proxy
(for example `https://vizer.example.org/oauth/callback`) — Twitch requires
`https` for anything other than localhost, and the path must stay
`/oauth/callback` because that is where the callback server answers. `VIZER_TOKEN_FILE` controls where twitchio persists OAuth tokens; the
Docker image points it at `/data/.tio.tokens.json` so tokens survive
redeploys via the mounted `./data` volume. `VIZER_EMOTES_DB_PATH` can also be
set when you need a non-default emote cache location; otherwise the backend
uses `backend/emotes/emotes.db` in local development.

### First run: authorize the bot in a browser

There is no token to paste into configuration. On the first start the backend
finds no stored token, prints a Twitch authorization URL (and opens it in a
browser when one is available), and waits. Log in as the bot account (usually
your broadcaster account) and approve; the requested scopes cover chat,
follows, subscriptions, cheers, and channel point redemptions (raid events
need no scope). The token is then written to `VIZER_TOKEN_FILE`, and the
authorizing account's user ID — which is how the backend knows who the bot
is — to a sidecar file next to it. Every later start skips this step,
refreshing the token in place when it expires.

### Migrating from older versions

- `TWITCH_ACCESS_TOKEN` and `TWITCH_REFRESH_TOKEN` were removed. Tokens now
  come only from the browser authorization above. If you already have a
  working `.tio.tokens.json` from a previous version, nothing changes —
  startup keeps using it. If you only had the env tokens, remove them from
  `.env` and approve the browser prompt once on the next start.
- `TWITCH_BOT_USERNAME` is no longer required and should be left unset on new
  installs. It is read only as a tie-breaker when a token file created by an
  older version contains tokens for several users and the backend cannot tell
  which entry is the bot's.

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

### First run: authorize with Twitch in your browser

On the very first start there is no stored OAuth token yet, so the backend
prints an authorization URL and waits. Find it in the logs and open it in the
browser on your host machine:

```bash
docker compose logs -f
```

Approving the Twitch prompt redirects your browser to
`http://localhost:4343/oauth/callback`, which Compose maps into the container
(the service publishes port `4343` alongside `8080`, and sets
`VIZER_OAUTH_HOST=0.0.0.0` so the callback server is reachable through that
mapping). The token is then written to `/data/.tio.tokens.json` on the mounted
`./data` volume, so later restarts and image upgrades skip this step entirely.

Two things to know:

- Your Twitch application (in the [developer console](https://dev.twitch.tv/console/apps))
  must have `http://localhost:4343/oauth/callback` registered as an OAuth
  redirect URL, exactly as written.
- Because the redirect goes to `localhost`, the browser must run on the same
  machine that publishes port 4343. On a remote server, forward the port first
  (`ssh -L 4343:localhost:4343 user@server`), then open the logged URL locally.

To build the image from local sources instead of pulling it, add the build
override file:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

The Compose service publishes `8080:8080` (overlay pages and WebSocket) and
`4343:4343` (OAuth callback), reads `.env`, and mounts `./data` to `/data` for
runtime persistence. The base `docker-compose.yml` stays pull-only
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
backend/vizer/oauth_setup.py  first-run browser OAuth flow and token checks
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
`cheer`, `raid`, `gift_sub`, and `redemption` (a viewer redeeming a custom
channel points reward — `data` carries the reward title, its point cost, and
the viewer's text input when the reward asks for one).

Redemption events only arrive if the broadcaster's OAuth token includes the
`channel:read:redemptions` scope (or the broader `channel:manage:redemptions`);
without it, Twitch rejects the EventSub subscription.
