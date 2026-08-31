"""Twitch adapter layer for twitch-vizer.

VizBot subclasses twitchio's AutoBot which handles:
  - EventSub WebSocket connection management
  - Automatic token refresh
  - Command prefix routing (prefix="!")

This module is intentionally thin: it translates raw Twitch events into
QueuedMessages and drops them onto the shared asyncio.Queue.  All visual
dispatch logic lives in handler.py.

Subscriptions are registered in two places:
  - __init__: the initial ChatMessageSubscription for the bot's own channel,
    required for the EventSub handshake before any user authenticates.
  - event_oauth_authorized: per-broadcaster subscriptions added after a user
    completes the OAuth flow via the twitchio built-in /oauth route.
"""

import asyncio
import logging
from typing import Any

import twitchio
from twitchio import ChatMessage, Client, eventsub, MultiSubscribePayload, Scopes
from twitchio.authentication import UserTokenPayload, ValidateTokenPayload
from twitchio.ext import commands
from twitchio.web import AiohttpAdapter

from .config import TwitchCredentials
from .emote_urls import (
    animated_twitch_emote_url,
    plain_twitch_emote_url,
    twitch_emote_cdn_url,
)
from .handler import EventType, MessageKind, MessagePart, QueuedMessage

LOGGER: logging.Logger = logging.getLogger(__name__)

# Chatter avatar URLs are cached per user; the cap keeps memory bounded on
# long-running processes with busy chats (oldest entries are evicted first).
_AVATAR_CACHE_MAX_SIZE = 1024


# ── twitchio payload probing ──────────────────────────────────────────────────
# EventSub payloads reach us either as twitchio model objects or as raw dicts,
# and field spellings have drifted between twitchio releases.  These helpers
# take `object` on purpose and probe a few known shapes so a twitchio upgrade
# degrades gracefully (missing URL / empty text) instead of crashing the bot.


def _asset_to_url(asset: object) -> str:
    """Best-effort conversion of TwitchIO asset-ish objects to a URL string."""
    if asset is None:
        return ""
    if isinstance(asset, str):
        return plain_twitch_emote_url(asset)
    for attr in ("url", "_url", "url_4x", "url_2x", "url_1x"):
        value = getattr(asset, attr, None)
        if callable(value):
            value = value()
        if isinstance(value, str) and value:
            return plain_twitch_emote_url(value)
    if isinstance(asset, dict):
        for key in ("static_url", "url_4x", "url_2x", "url_1x", "url", "src"):
            value = asset.get(key)
            if isinstance(value, str) and value:
                return plain_twitch_emote_url(value)
    value = str(asset)
    if value.startswith(("http://", "https://")):
        return plain_twitch_emote_url(value)
    return ""


def _login_of(user: object) -> str | None:
    """First name-ish attribute twitchio exposes for a user, if any."""
    for attr in ("name", "login", "display_name"):
        value = getattr(user, attr, None)
        if value:
            return str(value)
    return None


def _nested_attr(source: object, *path: str) -> object:
    value = source
    for attr in path:
        if value is None:
            return None
        if isinstance(value, dict):
            value = value.get(attr)
        else:
            value = getattr(value, attr, None)
    return value


def _fragment_emote_id(fragment: object) -> str:
    value = (
        _nested_attr(fragment, "emote", "id")
        or _nested_attr(fragment, "emote_id")
        or _nested_attr(fragment, "id")
    )
    return str(value) if value else ""


def _fragment_emote_url(fragment: object) -> str:
    """Extract an emote image URL from a Twitch message fragment when available."""
    for path in (
        ("url",),
        ("image",),
        ("images", "url_4x"),
        ("images", "url_2x"),
        ("images", "url_1x"),
        ("emote", "url"),
        ("emote", "image"),
        ("emote", "images", "url_4x"),
        ("emote", "images", "url_2x"),
        ("emote", "images", "url_1x"),
    ):
        url = _asset_to_url(_nested_attr(fragment, *path))
        if url:
            return url

    emote_id = _fragment_emote_id(fragment)
    if emote_id:
        return twitch_emote_cdn_url(emote_id)
    return ""


def _fragment_animated_emote_url(fragment: object) -> str:
    """Return an animated Twitch emote URL candidate for clients that support GIFs."""
    emote_id = _fragment_emote_id(fragment)
    if emote_id:
        return twitch_emote_cdn_url(emote_id, animated=True)

    static_url = _fragment_emote_url(fragment)
    if not static_url:
        return ""
    animated_url = animated_twitch_emote_url(static_url)
    return animated_url if animated_url != static_url else ""


def _string_value(value: object, fallback: str = "") -> str:
    if value is None:
        return fallback
    if isinstance(value, str):
        return value
    enum_value = getattr(value, "value", None)
    if isinstance(enum_value, str):
        return enum_value
    enum_name = getattr(value, "name", None)
    if isinstance(enum_name, str):
        return enum_name
    return str(value)


def _fragment_text(fragment: object) -> str:
    value = _nested_attr(fragment, "text")
    if isinstance(value, str):
        return value
    value = _nested_attr(fragment, "content")
    if isinstance(value, str):
        return value
    return ""


def _fragment_type(fragment: object) -> str:
    value = (
        _nested_attr(fragment, "type")
        or _nested_attr(fragment, "fragment_type")
        or _nested_attr(fragment, "kind")
    )
    return _string_value(value, "text").lower()


def _message_parts_from_fragments(
    fragments: object,
    fallback_text: str = "",
) -> tuple[str, list[str], list[MessagePart]]:
    """Convert TwitchIO/EventSub fragments into text, emote names, and render parts."""
    text_fragments: list[str] = []
    emote_names: list[str] = []
    parts: list[MessagePart] = []

    if not isinstance(fragments, list | tuple) or not fragments:
        if fallback_text:
            return fallback_text, [], [MessagePart(type="text", text=fallback_text)]
        return "", [], []

    for fragment in fragments:
        fragment_text = _fragment_text(fragment)
        fragment_type = _fragment_type(fragment)

        if fragment_type == "emote":
            emote_name = fragment_text or _string_value(
                _nested_attr(fragment, "emote", "name")
            )
            emote_names.append(emote_name)
            emote_url = _fragment_emote_url(fragment)
            parts.append(
                MessagePart(
                    type="image",
                    name=emote_name,
                    url=emote_url,
                    animated_url=_fragment_animated_emote_url(fragment),
                    static_url=emote_url,
                )
            )
            continue

        if fragment_text:
            text_fragments.append(fragment_text)
            parts.append(MessagePart(type="text", text=fragment_text))

    text = "".join(text_fragments).strip()
    return text, emote_names, parts


async def get_user_id(username: str, credentials: TwitchCredentials) -> str:
    """Fetch Twitch user ID by login name.

    Opens a short-lived API client, makes one GET /users call, then closes.
    Called once at startup to resolve the configured bot username to a numeric ID.

    Args:
        username: Twitch login name (slug, not display name).

    Returns:
        User ID string.

    Raises:
        ValueError: If user not found.
    """
    async with Client(
        client_id=credentials.client_id,
        client_secret=credentials.client_secret,
    ) as client:
        await client.login(load_tokens=False, save_tokens=False)
        users = await client.fetch_users(logins=[username])
        if not users:
            raise ValueError(f"User not found: {username}")
        return users[0].id


class VizBot(commands.AutoBot):
    """Twitch EventSub bot that feeds chat and channel events into the visual event queue.

    Inherits from AutoBot which manages the EventSub WebSocket, token storage,
    and built-in OAuth flow at /oauth/authorize.
    """

    def __init__(
        self,
        *,
        bot_id: str,
        subs: list[eventsub.SubscriptionPayload],
        message_queue: asyncio.Queue["QueuedMessage"],
        credentials: TwitchCredentials,
        adapter: AiohttpAdapter[Any],
        scopes: Scopes,
        token_file: str | None = None,
    ) -> None:
        """Initialize the Twitch bot with EventSub subscriptions and message queue.

        Args:
            bot_id: Twitch user ID of the bot account.
            subs: List of EventSub subscriptions to register at connection time.
            message_queue: Queue for dispatching events to the handler.
            adapter: Web adapter serving the /oauth and /oauth/callback routes
                that let additional broadcasters authorize the bot at runtime.
            scopes: Default OAuth scopes for /oauth visits without ?scopes=.
            token_file: Path for twitchio's OAuth token store; None keeps the
                twitchio default (.tio.tokens.json in the working directory).
        """
        self._message_queue = message_queue
        self._token_file = token_file
        self._avatar_url_cache: dict[str, str | None] = {}
        super().__init__(
            client_id=credentials.client_id,
            client_secret=credentials.client_secret,
            bot_id=bot_id,
            owner_id=bot_id,
            prefix="!",
            subscriptions=subs,
            force_subscribe=True,
            adapter=adapter,
            scopes=scopes,
        )

    async def _get_avatar_url(self, chatter: object) -> str | None:
        """Fetch and cache the chatter profile image URL for overlay avatars."""
        chatter_id = getattr(chatter, "id", None) or getattr(chatter, "user_id", None)
        login = _login_of(chatter)
        cache_key = str(chatter_id or login or "").lower()
        if not cache_key:
            return None
        if cache_key in self._avatar_url_cache:
            return self._avatar_url_cache[cache_key]

        try:
            if chatter_id:
                user = await self.fetch_user(id=str(chatter_id))
            elif login:
                user = await self.fetch_user(login=login)
            else:
                return None
        except Exception as exc:
            LOGGER.warning("Could not fetch avatar for %s: %s", cache_key, exc)
            # Cache the failure so a Helix outage is not retried per message.
            self._cache_avatar_url(cache_key, None)
            return None

        # twitchio 3.x User exposes profile_image as an Asset object.
        avatar_url = _asset_to_url(getattr(user, "profile_image", None))
        self._cache_avatar_url(cache_key, avatar_url or None)
        return avatar_url or None

    def _cache_avatar_url(self, cache_key: str, avatar_url: str | None) -> None:
        if len(self._avatar_url_cache) >= _AVATAR_CACHE_MAX_SIZE:
            oldest_key = next(iter(self._avatar_url_cache))
            del self._avatar_url_cache[oldest_key]
        self._avatar_url_cache[cache_key] = avatar_url

    def _display_name(self, user: object | None, fallback: str = "anonymous") -> str:
        return _login_of(user) or fallback

    async def load_tokens(self, path: str | None = None, /) -> None:
        """Load persisted OAuth tokens, defaulting to the configured token file."""
        await super().load_tokens(path or self._token_file)

    async def save_tokens(self, path: str | None = None, /) -> None:
        """Persist OAuth tokens, defaulting to the configured token file."""
        await super().save_tokens(path or self._token_file)

    async def _enqueue_system_event(
        self,
        *,
        username: str,
        event: EventType,
        data: dict[str, Any] | None = None,
    ) -> None:
        await self._message_queue.put(
            QueuedMessage(
                username=username,
                text="",
                kind=MessageKind.SYSTEM,
                system_event=event,
                system_data=data or {},
            )
        )

    def _subscriptions_for_user(
        self, user_id: str
    ) -> list[eventsub.SubscriptionPayload]:
        return [
            eventsub.ChatMessageSubscription(
                broadcaster_user_id=user_id,
                user_id=self.bot_id,
            ),
            eventsub.ChannelFollowSubscription(
                broadcaster_user_id=user_id,
                moderator_user_id=self.bot_id,
            ),
            eventsub.ChannelSubscribeSubscription(
                broadcaster_user_id=user_id,
            ),
            eventsub.ChannelSubscriptionGiftSubscription(
                broadcaster_user_id=user_id,
            ),
            eventsub.ChannelSubscribeMessageSubscription(
                broadcaster_user_id=user_id,
            ),
            eventsub.ChannelCheerSubscription(
                broadcaster_user_id=user_id,
            ),
            eventsub.ChannelRaidSubscription(
                to_broadcaster_user_id=user_id,
            ),
            eventsub.ChannelPointsRedeemAddSubscription(
                broadcaster_user_id=user_id,
            ),
        ]

    async def event_message(self, payload: ChatMessage) -> None:
        """Handle incoming Twitch chat message by enqueuing it for visual dispatch.

        Args:
            payload: Chat message event from EventSub.
        """
        text, emote_names, parts = _message_parts_from_fragments(
            getattr(payload, "fragments", []),
            fallback_text=getattr(payload, "text", ""),
        )
        username = self._display_name(payload.chatter, fallback="unknown")
        avatar_url = await self._get_avatar_url(payload.chatter)
        LOGGER.info(
            "Received message: %s — text=%r emotes=%r avatar=%s",
            username,
            text,
            emote_names,
            bool(avatar_url),
        )
        await self._message_queue.put(
            QueuedMessage(
                username=username,
                text=text,
                avatar_url=avatar_url,
                emote_names=emote_names,
                parts=parts,
            )
        )
        await super().event_message(payload)

    async def event_oauth_authorized(self, payload: UserTokenPayload) -> None:
        """Handle OAuth token authorization and subscribe to chat and channel events.

        Fires when a broadcaster visits the twitchio built-in OAuth callback URL.

        Args:
            payload: OAuth authorization payload with user_id and tokens.
        """
        await self.add_token(payload.access_token, payload.refresh_token)
        if not payload.user_id:
            LOGGER.warning(
                "OAuth authorization did not include a user_id; skipping subscriptions"
            )
            return

        subs = self._subscriptions_for_user(payload.user_id)
        LOGGER.info("Subscribing for user: %s", payload.user_id)
        resp: MultiSubscribePayload = await self.multi_subscribe(subs)
        if resp.errors:
            LOGGER.warning(
                "Failed to subscribe to: %r, for user: %s", resp.errors, payload.user_id
            )

    async def add_token(self, token: str, refresh: str) -> ValidateTokenPayload:
        """Add or validate a Twitch OAuth token.

        Args:
            token: Access token.
            refresh: Refresh token.

        Returns:
            Token validation response with user ID and expiration.
        """
        resp: ValidateTokenPayload = await super().add_token(token, refresh)
        LOGGER.info("Added token for user: %s", resp.user_id)
        return resp

    async def event_ready(self) -> None:
        """Called when the bot is connected and ready to receive events."""
        LOGGER.info("Successfully logged in as: %s", self.bot_id)

    # ── Channel event handlers ────────────────────────────────────────────────
    # Each handler wraps the Twitch event in a SYSTEM-kind QueuedMessage with
    # a typed system_event value and structured system_data dict.

    async def event_follow(self, payload: twitchio.ChannelFollow) -> None:
        username = self._display_name(payload.user)
        LOGGER.info("New follow from %s", username)
        await self._enqueue_system_event(username=username, event=EventType.FOLLOW)

    async def event_subscription(self, payload: twitchio.ChannelSubscribe) -> None:
        if payload.gift:
            return  # handled by event_subscription_gift
        username = self._display_name(payload.user)
        LOGGER.info("New subscription from %s (tier %s)", username, payload.tier)
        await self._enqueue_system_event(
            username=username,
            event=EventType.SUB,
            data={"tier": payload.tier},
        )

    async def event_subscription_gift(
        self, payload: twitchio.ChannelSubscriptionGift
    ) -> None:
        display = self._display_name(payload.user)
        LOGGER.info("Gift sub from %s: %d subs", display, payload.total)
        await self._enqueue_system_event(
            username=display,
            event=EventType.GIFT_SUB,
            data={"total": payload.total},
        )

    async def event_subscription_message(
        self, payload: twitchio.ChannelSubscriptionMessage
    ) -> None:
        username = self._display_name(payload.user)
        LOGGER.info("Resub from %s (%d months)", username, payload.cumulative_months)
        await self._enqueue_system_event(
            username=username,
            event=EventType.SUB,
            data={"tier": payload.tier, "months": payload.cumulative_months},
        )

    async def event_cheer(self, payload: twitchio.ChannelCheer) -> None:
        display = self._display_name(payload.user)
        LOGGER.info("Cheer from %s: %d bits", display, payload.bits)
        await self._enqueue_system_event(
            username=display,
            event=EventType.CHEER,
            data={"bits": payload.bits},
        )

    async def event_custom_redemption_add(
        self, payload: twitchio.ChannelPointsRedemptionAdd
    ) -> None:
        username = self._display_name(payload.user)
        reward_title = payload.reward.title
        LOGGER.info("Redemption from %s: %s", username, reward_title)
        data: dict[str, Any] = {
            "reward": reward_title,
            "cost": payload.reward.cost,
        }
        if payload.user_input:
            data["input"] = payload.user_input
        await self._enqueue_system_event(
            username=username,
            event=EventType.REDEMPTION,
            data=data,
        )

    async def event_raid(self, payload: twitchio.ChannelRaid) -> None:
        raider = self._display_name(payload.from_broadcaster, fallback="unknown")
        viewers = payload.viewer_count
        LOGGER.info("Raid from %s with %d viewers", raider, viewers)
        await self._enqueue_system_event(
            username=raider,
            event=EventType.RAID,
            data={"viewers": viewers},
        )
