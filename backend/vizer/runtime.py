"""Composition root for twitch-vizer.

This module is the single place that instantiates every component and wires
their dependencies together. Nothing here contains business logic; it only
creates objects and connects them.
"""

import asyncio
import logging

from twitchio import eventsub
from twitchio.web import AiohttpAdapter

from .bot import VizBot
from .config import Settings, load_settings
from .handler import MessageHandler, QueuedMessage
from .log import setup_logging
from .oauth_setup import ensure_authorized, vizer_scopes
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

    # Blocks on the first run until the user approves the app in a browser;
    # afterwards the persisted token file makes this a quick validation call.
    bot_id = await ensure_authorized(settings)
    subs: list[eventsub.SubscriptionPayload] = [
        eventsub.ChatMessageSubscription(broadcaster_user_id=bot_id, user_id=bot_id)
    ]
    LOGGER.info("Bot user ID: %s", bot_id)

    async with VizBot(
        bot_id=bot_id,
        subs=subs,
        message_queue=message_queue,
        credentials=settings.twitch,
        # The running bot serves the same OAuth routes the bootstrap used, so
        # additional broadcasters can authorize while the bot is live.
        adapter=AiohttpAdapter(
            host=settings.oauth.host,
            port=settings.oauth.port,
            domain=settings.oauth.domain,
        ),
        scopes=vizer_scopes(),
        token_file=settings.token_file,
    ) as bot:
        # ensure_authorized guarantees the token file exists by now.
        tasks = [
            asyncio.create_task(bot.start(load_tokens=True)),
            asyncio.create_task(server.serve()),
            asyncio.create_task(handler.process_queue()),
        ]
        try:
            await asyncio.gather(*tasks)
        finally:
            # None of the three ever returns on its own, so reaching here means
            # one failed or the run was cancelled; stop the siblings before the
            # bot context manager tears the client down underneath them.
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)


def main() -> None:
    """Entry point: run the async event loop."""
    asyncio.run(run())
