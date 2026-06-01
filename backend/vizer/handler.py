"""Core business logic for dispatching Twitch chat events to visual overlays.

Pipeline for a USER message:
  1. Derive a deterministic color and seed from the username hash.
  2. Build a VisualEvent dataclass.
  3. Broadcast the event JSON over WebSocket to all connected browser clients.

SYSTEM messages (follows, subs, raids, cheers) follow the same broadcast path
but carry an event type string and structured data dict instead of chat text.
"""

import asyncio
import hashlib
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from enum import Enum, auto

LOGGER: logging.Logger = logging.getLogger(__name__)


# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class VisualEvent:
    """Payload broadcast over WebSocket to connected browser scenes."""
    event: str           # "chat_message" | "follow" | "sub" | "cheer" | "raid" | "gift_sub"
    username: str
    text: str = ""
    color: str = "#4CAF50"
    seed: int = 0
    data: dict = field(default_factory=dict)


class MessageKind(Enum):
    """Distinguishes chat messages from channel-event announcements."""
    USER = auto()    # regular chatter message
    SYSTEM = auto()  # follow/sub/raid/cheer — broadcast directly


@dataclass
class QueuedMessage:
    """A message waiting to be dispatched to the visual overlay."""
    username: str
    text: str
    kind: MessageKind = field(default=MessageKind.USER)
    system_event: str = ""      # "follow", "sub", "cheer", "raid", "gift_sub"
    system_data: dict = field(default_factory=dict)
    avatar_url: str | None = None


# ── MessageHandler ────────────────────────────────────────────────────────────

class MessageHandler:
    """Dispatches queued messages as VisualEvents to connected WebSocket clients."""

    def __init__(
        self,
        broadcast: Callable[[VisualEvent], Awaitable[None]],
        message_queue: asyncio.Queue["QueuedMessage"],
    ) -> None:
        self._broadcast = broadcast
        self._message_queue = message_queue

    def _username_to_color(self, username: str) -> str:
        """Derive a deterministic hex color from the username's SHA-256 hash."""
        digest = hashlib.sha256(username.encode()).digest()
        r, g, b = digest[0], digest[1], digest[2]
        return f"#{r:02x}{g:02x}{b:02x}"

    def _username_to_seed(self, username: str) -> int:
        """Derive a deterministic integer seed from the username's SHA-256 hash."""
        digest = hashlib.sha256(username.encode()).digest()
        return int.from_bytes(digest[:4], "big") & 0xFFFFFF

    async def handle(self, message: QueuedMessage) -> None:
        """Convert a queued message into a VisualEvent and broadcast it."""
        if message.kind is MessageKind.SYSTEM:
            event = VisualEvent(
                event=message.system_event,
                username=message.username,
                data=message.system_data,
            )
        else:
            event = VisualEvent(
                event="chat_message",
                username=message.username,
                text=message.text,
                color=self._username_to_color(message.username),
                seed=self._username_to_seed(message.username),
            )
        LOGGER.info("Broadcasting %s event for %s", event.event, event.username)
        await self._broadcast(event)

    async def process_queue(self) -> None:
        """Continuously drain the message queue, invoking handle() for each item.

        Errors in handle() are logged and swallowed so a bad message never kills the loop.
        """
        while True:
            msg: QueuedMessage = await self._message_queue.get()
            try:
                LOGGER.debug("Processing queued message from %s (%s)", msg.username, msg.kind.name)
                await self.handle(msg)
            except Exception:
                LOGGER.exception("Error processing message from %s", msg.username)
            finally:
                self._message_queue.task_done()
