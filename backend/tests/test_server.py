import json
import unittest
from typing import cast

from starlette.websockets import WebSocket

from vizer.handler import EventType, VisualEvent
from vizer.server import VizServer


class _StubWebSocket:
    """Minimal stand-in for a connected Starlette WebSocket."""

    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.sent: list[str] = []

    async def send_text(self, message: str) -> None:
        if self.fail:
            raise RuntimeError("connection closed")
        self.sent.append(message)


class BroadcastTest(unittest.IsolatedAsyncioTestCase):
    def _server_with_clients(self, *stubs: _StubWebSocket) -> VizServer:
        server = VizServer(host="127.0.0.1", port=0)
        for stub in stubs:
            server._clients.add(cast(WebSocket, stub))
        return server

    async def test_sends_serialized_event_to_all_clients(self) -> None:
        first, second = _StubWebSocket(), _StubWebSocket()
        server = self._server_with_clients(first, second)

        await server.broadcast(VisualEvent(event=EventType.FOLLOW, username="viewer"))

        for stub in (first, second):
            self.assertEqual(len(stub.sent), 1)
            payload = json.loads(stub.sent[0])
            self.assertEqual(payload["event"], "follow")
            self.assertEqual(payload["username"], "viewer")

    async def test_evicts_dead_clients_and_keeps_live_ones(self) -> None:
        live, dead = _StubWebSocket(), _StubWebSocket(fail=True)
        server = self._server_with_clients(live, dead)

        await server.broadcast(VisualEvent(event=EventType.RAID, username="raider"))

        self.assertEqual(server._clients, {cast(WebSocket, live)})
        self.assertEqual(len(live.sent), 1)

    async def test_no_clients_is_a_noop(self) -> None:
        server = self._server_with_clients()

        await server.broadcast(VisualEvent(event=EventType.SUB, username="viewer"))


if __name__ == "__main__":
    unittest.main()
