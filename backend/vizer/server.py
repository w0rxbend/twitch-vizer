"""HTTP and WebSocket server for OBS browser source overlays.

Built on Starlette + uvicorn.  Serves:
  - A JSON service index at /.
  - A WebSocket endpoint at /ws that pushes VisualEvents to all connected clients.

If static frontend assets are present in vizer/static/, they are exposed as a
convenience for local combined hosting. The bot/server runtime does not require
frontend files; overlays can be hosted separately and pointed at /ws.
"""

import asyncio
import dataclasses
import json
import logging
from pathlib import Path

import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, RedirectResponse, Response
from starlette.routing import Mount, Route, WebSocketRoute
from starlette.staticfiles import StaticFiles
from starlette.websockets import WebSocket, WebSocketDisconnect

from .handler import VisualEvent

LOGGER: logging.Logger = logging.getLogger(__name__)

_STATIC_DIR = Path(__file__).parent / "static"


class VizServer:
    """Starlette-based HTTP + WebSocket server for visual overlay delivery."""

    def __init__(self, host: str, port: int, static_dir: Path | None = None) -> None:
        self._host = host
        self._port = port
        self._static_dir = static_dir or _STATIC_DIR
        self._scenes_dir = self._static_dir / "scenes"
        # Plain set is fine — all access happens on the single asyncio thread.
        self._clients: set[WebSocket] = set()
        self._app = self._build_app()

    def _build_app(self) -> Starlette:
        """Build and return the Starlette ASGI application with all routes wired up."""

        async def index(request: Request) -> JSONResponse:
            # List subdirectory names under static/scenes/ as available scenes.
            scenes: list[str] = []
            if self._scenes_dir.exists():
                scenes = sorted(
                    p.name for p in self._scenes_dir.iterdir() if p.is_dir()
                )
            return JSONResponse(
                {"service": "twitch-vizer", "websocket": "/ws", "scenes": scenes}
            )

        async def scene_redirect(request: Request) -> RedirectResponse:
            name = request.path_params["name"]
            return RedirectResponse(url=f"/scenes/{name}/", status_code=301)

        async def scenes_redirect(request: Request) -> RedirectResponse:
            return RedirectResponse(url="/scenes/", status_code=301)

        async def scenes_index(request: Request) -> Response:
            page = self._scenes_dir / "index.html"
            if not page.exists():
                return Response("Scenes index not found", status_code=404)
            return FileResponse(page, headers={"Cache-Control": "no-store"})

        async def scene_page(request: Request) -> Response:
            name = request.path_params["name"]
            # Resolve and guard against path traversal
            page = (self._scenes_dir / name / "index.html").resolve()
            if not page.is_relative_to(self._scenes_dir.resolve()):
                return Response("Not found", status_code=404)
            if not page.exists():
                return Response("Scene not found", status_code=404)
            return FileResponse(page, headers={"Cache-Control": "no-store"})

        async def favicon(request: Request) -> Response:
            return Response(content=b"", media_type="image/x-icon")

        async def ws_endpoint(websocket: WebSocket) -> None:
            """Handle a single WebSocket client connection.

            Server-to-client only; no client messages are expected.
            """
            await websocket.accept()
            self._clients.add(websocket)
            LOGGER.info(
                "WebSocket client connected — %d client(s) active", len(self._clients)
            )
            try:
                # Keep the connection alive; ignore any client-sent data
                while True:
                    await websocket.receive_text()
            except WebSocketDisconnect:
                pass
            finally:
                self._clients.discard(websocket)
                LOGGER.info(
                    "WebSocket client disconnected — %d client(s) remaining",
                    len(self._clients),
                )

        routes = [
            Route("/", index),
            Route("/favicon.ico", favicon),
            Route("/scenes", scenes_redirect),
            Route("/scenes/", scenes_index),
            Route("/scenes/{name}", scene_redirect),
            Route("/scenes/{name}/", scene_page),
            WebSocketRoute("/ws", ws_endpoint),
        ]
        if self._static_dir.exists():
            routes.append(Mount("/static", StaticFiles(directory=self._static_dir)))

        return Starlette(routes=routes)

    async def broadcast(self, event: VisualEvent) -> None:
        """Send a visual event to all connected WebSocket clients.

        Sends run concurrently over a snapshot of the client set, so a client
        that has stopped reading only delays the broadcast by its own send
        instead of blocking every other overlay behind it. Clients whose send
        raised are dropped once all sends have settled.

        Args:
            event: VisualEvent to serialize and broadcast.
        """
        if not self._clients:
            LOGGER.debug("No WS clients connected, skipping broadcast")
            return
        LOGGER.info("Broadcasting %s to %d client(s)", event.event, len(self._clients))
        message = json.dumps(dataclasses.asdict(event))
        clients = list(self._clients)
        results = await asyncio.gather(
            *(ws.send_text(message) for ws in clients), return_exceptions=True
        )
        dead: set[WebSocket] = set()
        for ws, result in zip(clients, results):
            if isinstance(result, BaseException):
                LOGGER.debug(
                    "Dropping WS client after send failure: %r", result, exc_info=result
                )
                dead.add(ws)
        if dead:
            LOGGER.warning("Dropped %d stale client(s)", len(dead))
        self._clients -= dead

    async def serve(self) -> None:
        """Start the uvicorn server and block until shutdown."""
        config = uvicorn.Config(
            self._app,
            host=self._host,
            port=self._port,
            log_level="warning",
        )
        server = uvicorn.Server(config)
        await server.serve()
