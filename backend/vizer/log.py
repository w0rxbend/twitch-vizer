"""Logging configuration for twitch-vizer.

Sets up a single colorlog handler on the root logger so every module that
calls logging.getLogger(__name__) automatically inherits the coloured format.

Log level is controlled by the VIZER_LOG_LEVEL environment variable (default: INFO).
Noisy third-party loggers (websockets, uvicorn, asyncio) are quieted to WARNING
so they don't drown out the application's own output.
"""

import logging

import colorlog

from .config import LOG_LEVEL


def setup_logging() -> None:
    """Configure coloured logging with timestamp and module names.

    Called once at startup in vizer/__init__.py before any other component
    initialises so all subsequent log output is consistently formatted.
    """
    level = getattr(logging, LOG_LEVEL, logging.INFO)

    fmt = colorlog.ColoredFormatter(
        "%(log_color)s%(asctime)s  %(levelname)-8s%(reset)s  "
        "%(cyan)s%(name)-30s%(reset)s %(message)s",
        datefmt="%H:%M:%S",
        log_colors={
            "DEBUG":    "cyan",
            "INFO":     "green",
            "WARNING":  "yellow",
            "ERROR":    "red",
            "CRITICAL": "bold_red",
        },
        secondary_log_colors={
            "message": {
                "WARNING":  "yellow",
                "ERROR":    "red",
                "CRITICAL": "bold_red",
            },
        },
    )
    handler = colorlog.StreamHandler()
    handler.setFormatter(fmt)

    root = logging.getLogger()
    root.setLevel(level)
    root.handlers.clear()
    root.addHandler(handler)

    logging.getLogger("websockets").setLevel(logging.WARNING)
    logging.getLogger("uvicorn").setLevel(logging.WARNING)
    logging.getLogger("asyncio").setLevel(logging.WARNING)
