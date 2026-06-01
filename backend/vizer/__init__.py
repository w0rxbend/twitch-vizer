"""Composition root for twitch-vizer.

This module is the single place that instantiates every component and wires
their dependencies together.  Nothing here contains business logic — it only
creates objects and connects them.

Startup order matters:
  1. Logging must be configured before anything else logs.
  2. bot_id is fetched before the bot socket opens so subscriptions can reference it.
  3. asyncio.gather() starts all three long-running coroutines concurrently.
"""

import asyncio
import logging

from twitchio import eventsub

from .bot import VizBot, get_user_id
from .config import (
    ACCESS_TOKEN,
    BOT_USERNAME,
    EMOTES_DB_PATH,
    REFRESH_TOKEN,
    SERVER_HOST,
    SERVER_PORT,
)
from .handler import MessageHandler, QueuedMessage
from .log import setup_logging
from .server import VizServer

LOGGER: logging.Logger = logging.getLogger(__name__)


async def run() -> None:
    """Initialize and start the Twitch visual overlay bot with all components.

    Wires together: visual server, message handler, and Twitch bot.
    Runs bot, server, and message handler in concurrent tasks via asyncio.gather().
    """
    setup_logging()

    message_queue: asyncio.Queue[QueuedMessage] = asyncio.Queue()

    server = VizServer(host=SERVER_HOST, port=SERVER_PORT)

    handler = MessageHandler(
        broadcast=server.broadcast,
        message_queue=message_queue,
        emotes_db_path=EMOTES_DB_PATH,
    )

    bot_id = await get_user_id(BOT_USERNAME)
    subs: list[eventsub.SubscriptionPayload] = [
        eventsub.ChatMessageSubscription(broadcaster_user_id=bot_id, user_id=bot_id)
    ]
    LOGGER.info("Bot user ID: %s", bot_id)

    async with VizBot(bot_id=bot_id, subs=subs, message_queue=message_queue) as bot:
        await bot.add_token(ACCESS_TOKEN, REFRESH_TOKEN)

        await asyncio.gather(
            bot.start(load_tokens=False),
            server.serve(),
            handler.process_queue(),
        )


def main() -> None:
    """Entry point: run the async event loop."""
    asyncio.run(run())
