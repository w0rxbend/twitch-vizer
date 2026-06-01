"""HTTP and WebSocket server for OBS browser source overlays.

Built on Starlette + uvicorn.  Serves:
  - A JSON service index at /.
  - A WebSocket endpoint at /ws that pushes VisualEvents to all connected clients.

If static frontend assets are present in vizer/static/, they are exposed as a
convenience for local combined hosting. The bot/server runtime does not require
frontend files; overlays can be hosted separately and pointed at /ws.
"""

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
_SCENES_DIR = _STATIC_DIR / "scenes"


class VizServer:
    """Starlette-based HTTP + WebSocket server for visual overlay delivery."""

    def __init__(self, host: str, port: int) -> None:
        self._host = host
        self._port = port
        # Plain set is fine — all access happens on the single asyncio thread.
        self._clients: set[WebSocket] = set()
        self._app = self._build_app()

    def _build_app(self) -> Starlette:
        """Build and return the Starlette ASGI application with all routes wired up."""

        async def index(request: Request) -> JSONResponse:
            # List subdirectory names under static/scenes/ as available scenes.
            scenes: list[str] = []
            if _SCENES_DIR.exists():
                scenes = sorted(p.name for p in _SCENES_DIR.iterdir() if p.is_dir())
            return JSONResponse(
                {"service": "twitch-vizer", "websocket": "/ws", "scenes": scenes}
            )

        async def scene_redirect(request: Request) -> RedirectResponse:
            name = request.path_params["name"]
            return RedirectResponse(url=f"/scenes/{name}/", status_code=301)

        async def scene_page(request: Request) -> Response:
            name = request.path_params["name"]
            # Resolve and guard against path traversal
            page = (_SCENES_DIR / name / "index.html").resolve()
            if not page.is_relative_to(_SCENES_DIR.resolve()):
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
            LOGGER.info("WebSocket client connected — %d client(s) active", len(self._clients))
            try:
                # Keep the connection alive; ignore any client-sent data
                while True:
                    await websocket.receive_text()
            except WebSocketDisconnect:
                LOGGER.info(
                    "WebSocket client disconnected — %d client(s) remaining",
                    len(self._clients) - 1,
                )
            finally:
                self._clients.discard(websocket)

        routes = [
            Route("/", index),
            Route("/favicon.ico", favicon),
            Route("/scenes/{name}", scene_redirect),
            Route("/scenes/{name}/", scene_page),
            WebSocketRoute("/ws", ws_endpoint),
        ]
        if _STATIC_DIR.exists():
            routes.append(Mount("/static", StaticFiles(directory=_STATIC_DIR)))

        return Starlette(routes=routes)

    async def broadcast(self, event: VisualEvent) -> None:
        """Send a visual event to all connected WebSocket clients.

        Uses a snapshot of the client set to avoid mutation-during-iteration.
        Stale clients are collected and removed after the iteration.

        Args:
            event: VisualEvent to serialize and broadcast.
        """
        if not self._clients:
            LOGGER.debug("No WS clients connected, skipping broadcast")
            return
        LOGGER.info("Broadcasting %s to %d client(s)", event.event, len(self._clients))
        message = json.dumps(dataclasses.asdict(event))
        dead: set[WebSocket] = set()
        for ws in self._clients:
            try:
                await ws.send_text(message)
            except Exception:
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
