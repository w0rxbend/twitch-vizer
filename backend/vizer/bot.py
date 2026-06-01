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
    completes the OAuth flow via the twitchio built-in /oauth/authorize route.
"""

import asyncio
import logging

import twitchio
from twitchio import ChatMessage, Client, eventsub, MultiSubscribePayload
from twitchio.authentication import UserTokenPayload, ValidateTokenPayload
from twitchio.ext import commands

from .config import CLIENT_ID, CLIENT_SECRET
from .handler import MessageKind, QueuedMessage

LOGGER: logging.Logger = logging.getLogger(__name__)


async def get_user_id(username: str) -> str:
    """Fetch Twitch user ID by login name.

    Opens a short-lived API client, makes one GET /users call, then closes.
    Called once at startup to resolve BOT_USERNAME → numeric ID.

    Args:
        username: Twitch login name (slug, not display name).

    Returns:
        User ID string.

    Raises:
        ValueError: If user not found.
    """
    async with Client(client_id=CLIENT_ID, client_secret=CLIENT_SECRET) as client:
        await client.login()
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
    ) -> None:
        """Initialize the Twitch bot with EventSub subscriptions and message queue.

        Args:
            bot_id: Twitch user ID of the bot account.
            subs: List of EventSub subscriptions to register at connection time.
            message_queue: Queue for dispatching events to the handler.
        """
        self._message_queue = message_queue
        super().__init__(
            client_id=CLIENT_ID,
            client_secret=CLIENT_SECRET,
            bot_id=bot_id,
            owner_id=bot_id,
            prefix="!",
            subscriptions=subs,
            force_subscribe=True,
        )

    async def event_message(self, payload: ChatMessage) -> None:
        """Handle incoming Twitch chat message by enqueuing it for visual dispatch.

        Args:
            payload: Chat message event from EventSub.
        """
        # Join text fragments; skip emote/cheermote fragments which carry no readable text
        text = " ".join(
            fragment.text for fragment in payload.fragments if fragment.type == "text"
        ).strip()
        LOGGER.info("Received message: %s — %r", payload.chatter.name, text)
        await self._message_queue.put(
            QueuedMessage(
                username=payload.chatter.name,
                text=text,
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

        subs: list[eventsub.SubscriptionPayload] = [
            eventsub.ChatMessageSubscription(
                broadcaster_user_id=payload.user_id,
                user_id=self.bot_id,
            ),
            eventsub.ChannelFollowSubscription(
                broadcaster_user_id=payload.user_id,
                moderator_user_id=self.bot_id,
            ),
            eventsub.ChannelSubscribeSubscription(
                broadcaster_user_id=payload.user_id,
            ),
            eventsub.ChannelSubscriptionGiftSubscription(
                broadcaster_user_id=payload.user_id,
            ),
            eventsub.ChannelSubscribeMessageSubscription(
                broadcaster_user_id=payload.user_id,
            ),
            eventsub.ChannelCheerSubscription(
                broadcaster_user_id=payload.user_id,
            ),
            eventsub.ChannelRaidSubscription(
                to_broadcaster_user_id=payload.user_id,
            ),
        ]
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
    # a typed system_event string and structured system_data dict.

    async def event_follow(self, payload: twitchio.ChannelFollow) -> None:
        username = payload.user.name
        LOGGER.info("New follow from %s", username)
        await self._message_queue.put(
            QueuedMessage(
                username=username,
                text="",
                kind=MessageKind.SYSTEM,
                system_event="follow",
            )
        )

    async def event_subscription(self, payload: twitchio.ChannelSubscribe) -> None:
        if payload.gift:
            return  # handled by event_subscription_gift
        username = payload.user.name
        LOGGER.info("New subscription from %s (tier %s)", username, payload.tier)
        await self._message_queue.put(
            QueuedMessage(
                username=username,
                text="",
                kind=MessageKind.SYSTEM,
                system_event="sub",
                system_data={"tier": payload.tier},
            )
        )

    async def event_subscription_gift(
        self, payload: twitchio.ChannelSubscriptionGift
    ) -> None:
        username = payload.user.name if payload.user else None
        display = username or "anonymous"
        LOGGER.info("Gift sub from %s: %d subs", display, payload.total)
        await self._message_queue.put(
            QueuedMessage(
                username=display,
                text="",
                kind=MessageKind.SYSTEM,
                system_event="gift_sub",
                system_data={"total": payload.total},
            )
        )

    async def event_subscription_message(
        self, payload: twitchio.ChannelSubscriptionMessage
    ) -> None:
        username = payload.user.name
        LOGGER.info("Resub from %s (%d months)", username, payload.cumulative_months)
        await self._message_queue.put(
            QueuedMessage(
                username=username,
                text="",
                kind=MessageKind.SYSTEM,
                system_event="sub",
                system_data={"tier": payload.tier, "months": payload.cumulative_months},
            )
        )

    async def event_cheer(self, payload: twitchio.ChannelCheer) -> None:
        username = payload.user.name if payload.user else None
        display = username or "anonymous"
        LOGGER.info("Cheer from %s: %d bits", display, payload.bits)
        await self._message_queue.put(
            QueuedMessage(
                username=display,
                text="",
                kind=MessageKind.SYSTEM,
                system_event="cheer",
                system_data={"bits": payload.bits},
            )
        )

    async def event_raid(self, payload: twitchio.ChannelRaid) -> None:
        raider = payload.from_broadcaster.name
        viewers = payload.viewer_count
        LOGGER.info("Raid from %s with %d viewers", raider, viewers)
        await self._message_queue.put(
            QueuedMessage(
                username=raider,
                text="",
                kind=MessageKind.SYSTEM,
                system_event="raid",
                system_data={"viewers": viewers},
            )
        )
