"""Composition root for twitch-vizer.

This module is the single place that instantiates every component and wires
their dependencies together. Nothing here contains business logic; it only
creates objects and connects them.
"""

import asyncio
import logging

from twitchio import eventsub

from .bot import VizBot, get_user_id
from .config import Settings, load_settings
from .handler import MessageHandler, QueuedMessage
from .log import setup_logging
from .server import VizServer

LOGGER: logging.Logger = logging.getLogger(__name__)


async def run(settings: Settings | None = None) -> None:
    """Initialize and start the Twitch visual overlay bot with all components."""
    settings = settings or load_settings()
    setup_logging(settings.log_level)

    message_queue: asyncio.Queue[QueuedMessage] = asyncio.Queue()

    server = VizServer(host=settings.server.host, port=settings.server.port)

    handler = MessageHandler.with_default_factory(
        broadcast=server.broadcast,
        message_queue=message_queue,
        emotes_db_path=settings.emotes_db_path,
    )

    bot_id = await get_user_id(settings.bot_username, settings.twitch)
    subs: list[eventsub.SubscriptionPayload] = [
        eventsub.ChatMessageSubscription(broadcaster_user_id=bot_id, user_id=bot_id)
    ]
    LOGGER.info("Bot user ID: %s", bot_id)

    async with VizBot(
        bot_id=bot_id,
        subs=subs,
        message_queue=message_queue,
        credentials=settings.twitch,
    ) as bot:
        await bot.add_token(
            settings.twitch.access_token,
            settings.twitch.refresh_token,
        )

        await asyncio.gather(
            bot.start(load_tokens=False),
            server.serve(),
            handler.process_queue(),
        )


def main() -> None:
    """Entry point: run the async event loop."""
    asyncio.run(run())
