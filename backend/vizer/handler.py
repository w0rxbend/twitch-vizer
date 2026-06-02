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
import json
import logging
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from enum import Enum, auto
from pathlib import Path
from typing import Any

LOGGER: logging.Logger = logging.getLogger(__name__)


# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class EmoteItem:
    """A single Twitch emote or Unicode emoji image sent to the overlay."""
    name: str
    url: str


@dataclass
class MessagePart:
    """One inline message fragment for frontend rendering."""
    type: str  # "text" | "image"
    text: str = ""
    name: str = ""
    url: str = ""


@dataclass
class VisualEvent:
    """Payload broadcast over WebSocket to connected browser scenes."""
    event: str           # "chat_message" | "follow" | "sub" | "cheer" | "raid" | "gift_sub"
    username: str
    text: str = ""
    color: str = "#4CAF50"
    seed: int = 0
    avatar_url: str | None = None
    data: dict = field(default_factory=dict)
    emotes: list[EmoteItem] = field(default_factory=list)
    parts: list[MessagePart] = field(default_factory=list)


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
    emote_names: list[str] = field(default_factory=list)
    parts: list[MessagePart] = field(default_factory=list)


@dataclass(frozen=True)
class MessageContent:
    """Resolved message text and renderable inline parts."""

    text: str
    parts: list[MessagePart]
    emotes: list[EmoteItem]


@dataclass(frozen=True)
class VisualIdentity:
    """Stable per-user visual identity values."""

    color: str
    seed: int


# ── Emoji / emote helpers ─────────────────────────────────────────────────────

_TWEMOJI_BASE = "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72"


def _emoji_url(char: str) -> str:
    """Return the Twemoji PNG URL for an emoji cluster."""
    codepoints = "-".join(f"{ord(c):x}" for c in char if ord(c) != 0xFE0F)
    return f"{_TWEMOJI_BASE}/{codepoints}.png"


def _is_emoji_base(char: str) -> bool:
    cp = ord(char)
    return (
        0x1F000 <= cp <= 0x1FAFF
        or 0x2600 <= cp <= 0x27BF
        or 0x2300 <= cp <= 0x23FF
    )


def _is_emoji_modifier(char: str) -> bool:
    cp = ord(char)
    return cp == 0xFE0F or cp == 0x200D or cp == 0x20E3 or 0x1F3FB <= cp <= 0x1F3FF


def _emoji_cluster_at(text: str, start: int) -> tuple[str, int] | None:
    """Return (emoji_cluster, end_index) if text[start:] begins with emoji."""
    first = text[start]
    end = start + 1

    # Keycap emoji: 1️⃣, #️⃣, *️⃣
    if first in "0123456789#*":
        maybe_end = end
        if maybe_end < len(text) and ord(text[maybe_end]) == 0xFE0F:
            maybe_end += 1
        if maybe_end < len(text) and ord(text[maybe_end]) == 0x20E3:
            return text[start:maybe_end + 1], maybe_end + 1
        return None

    if not _is_emoji_base(first):
        return None

    while end < len(text):
        char = text[end]
        if _is_emoji_modifier(char):
            end += 1
            continue
        if ord(text[end - 1]) == 0x200D and _is_emoji_base(char):
            end += 1
            continue
        break
    return text[start:end], end


def _append_text_part(parts: list[MessagePart], text: str) -> None:
    if not text:
        return
    if parts and parts[-1].type == "text":
        parts[-1].text += text
    else:
        parts.append(MessagePart(type="text", text=text))


def _split_text_emojis(text: str) -> tuple[str, list[MessagePart], list[EmoteItem]]:
    """Split Unicode emoji into image parts while keeping non-emoji text inline."""
    clean: list[str] = []
    parts: list[MessagePart] = []
    emotes: list[EmoteItem] = []
    text_start = 0
    index = 0

    while index < len(text):
        cluster = _emoji_cluster_at(text, index)
        if not cluster:
            index += 1
            continue

        emoji, end = cluster
        segment = text[text_start:index]
        clean.append(segment)
        _append_text_part(parts, segment)
        url = _emoji_url(emoji)
        item = EmoteItem(name=emoji, url=url)
        emotes.append(item)
        parts.append(MessagePart(type="image", name=emoji, url=url))
        index = end
        text_start = end

    tail = text[text_start:]
    clean.append(tail)
    _append_text_part(parts, tail)
    return "".join(clean).strip(), parts, emotes


# ── Visual event collaborators ────────────────────────────────────────────────

class EmoteCatalog:
    """Resolves emote names to image URLs from a local cache and message hints."""

    def __init__(self, emotes: Mapping[str, dict[str, Any] | str] | None = None) -> None:
        self._emotes = dict(emotes or {})

    @classmethod
    def from_file(cls, path: str | None) -> "EmoteCatalog":
        """Load emote name -> URL records from the backend/emotes cache.

        The cache mirrors twitch-voxer: emotes.db is a pickledb JSON file shaped
        as {"Kappa": {"url_1x": "...", "url_2x": "...", "url_4x": "..."}}.
        all_emotes.json from the same folder is also accepted as a list fallback.
        """
        if not path:
            return cls()

        db_path = Path(path)
        if not db_path.exists():
            fallback = db_path.with_name("all_emotes.json")
            if fallback.exists():
                db_path = fallback
            else:
                LOGGER.warning("Emotes DB not found at %s", path)
                return cls()

        try:
            raw: object = json.loads(db_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            LOGGER.warning("Could not load emotes cache (%s): %s", db_path, exc)
            return cls()

        if isinstance(raw, list):
            raw = {
                item["name"]: item
                for item in raw
                if isinstance(item, dict) and isinstance(item.get("name"), str)
            }

        if not isinstance(raw, dict):
            LOGGER.warning("Ignoring emotes cache with unexpected format: %s", db_path)
            return cls()

        emotes: dict[str, dict[str, Any] | str] = {
            str(name): value
            for name, value in raw.items()
            if isinstance(value, str) or isinstance(value, dict)
        }
        LOGGER.info("Loaded %d emotes from %s", len(emotes), db_path)
        return cls(emotes)

    def resolve(self, name: str, url: str = "") -> EmoteItem | None:
        record = self._emotes.get(name)
        if isinstance(record, str) and record:
            return EmoteItem(name=name, url=record)
        if isinstance(record, dict):
            resolved = self._best_url(record)
            if resolved:
                return EmoteItem(name=name, url=resolved)
        if url:
            return EmoteItem(name=name, url=url)
        return None

    def _best_url(self, record: Mapping[str, Any]) -> str:
        resolved = (
            record.get("url_4x")
            or record.get("url_3x")
            or record.get("url_2x")
            or record.get("url_1x")
            or record.get("url")
        )
        return resolved if isinstance(resolved, str) else ""


class UserVisualIdentity:
    """Builds deterministic visual identity values from a username."""

    def for_username(self, username: str) -> VisualIdentity:
        digest = hashlib.sha256(username.encode()).digest()
        return VisualIdentity(
            color=self._color_from_digest(digest),
            seed=int.from_bytes(digest[:4], "big") & 0xFFFFFF,
        )

    def _color_from_digest(self, digest: bytes) -> str:
        """Derive a deterministic hex color from the username's SHA-256 hash."""
        r, g, b = digest[0], digest[1], digest[2]
        return f"#{r:02x}{g:02x}{b:02x}"


class MessageContentResolver:
    """Converts queued message fragments into overlay-ready content."""

    def __init__(self, emote_catalog: EmoteCatalog) -> None:
        self._emote_catalog = emote_catalog

    def resolve(self, message: QueuedMessage) -> MessageContent:
        """Resolve queued text/emote fragments into clean text and inline render parts."""
        source_parts = message.parts or [MessagePart(type="text", text=message.text)]
        clean_segments: list[str] = []
        parts: list[MessagePart] = []
        emotes: list[EmoteItem] = []

        for part in source_parts:
            if part.type == "image":
                item = self._emote_catalog.resolve(part.name or part.text, part.url)
                if item:
                    parts.append(MessagePart(type="image", name=item.name, url=item.url))
                    emotes.append(item)
                continue

            clean, text_parts, emoji_items = _split_text_emojis(part.text)
            clean_segments.append(clean)
            parts.extend(text_parts)
            emotes.extend(emoji_items)

        for name in message.emote_names:
            if any(item.name == name for item in emotes):
                continue
            item = self._emote_catalog.resolve(name)
            if item:
                parts.append(MessagePart(type="image", name=item.name, url=item.url))
                emotes.append(item)

        clean_text = " ".join(segment for segment in clean_segments if segment).strip()
        return MessageContent(text=clean_text, parts=parts, emotes=emotes)


class VisualEventFactory:
    """Creates broadcast payloads from queued messages."""

    def __init__(
        self,
        content_resolver: MessageContentResolver,
        identity: UserVisualIdentity,
    ) -> None:
        self._content_resolver = content_resolver
        self._identity = identity

    def create(self, message: QueuedMessage) -> VisualEvent:
        if message.kind is MessageKind.SYSTEM:
            return VisualEvent(
                event=message.system_event,
                username=message.username,
                data=message.system_data,
            )

        content = self._content_resolver.resolve(message)
        identity = self._identity.for_username(message.username)
        return VisualEvent(
            event="chat_message",
            username=message.username,
            text=content.text,
            color=identity.color,
            seed=identity.seed,
            avatar_url=message.avatar_url,
            emotes=content.emotes,
            parts=content.parts,
        )


# ── MessageHandler ────────────────────────────────────────────────────────────

class MessageHandler:
    """Dispatches queued messages as VisualEvents to connected WebSocket clients."""

    def __init__(
        self,
        broadcast: Callable[[VisualEvent], Awaitable[None]],
        message_queue: asyncio.Queue["QueuedMessage"],
        event_factory: VisualEventFactory,
    ) -> None:
        self._broadcast = broadcast
        self._message_queue = message_queue
        self._event_factory = event_factory

    @classmethod
    def with_default_factory(
        cls,
        broadcast: Callable[[VisualEvent], Awaitable[None]],
        message_queue: asyncio.Queue["QueuedMessage"],
        emotes_db_path: str | None = None,
    ) -> "MessageHandler":
        emotes = EmoteCatalog.from_file(emotes_db_path)
        content_resolver = MessageContentResolver(emotes)
        event_factory = VisualEventFactory(content_resolver, UserVisualIdentity())
        return cls(broadcast, message_queue, event_factory)

    async def handle(self, message: QueuedMessage) -> None:
        """Convert a queued message into a VisualEvent and broadcast it."""
        event = self._event_factory.create(message)
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
