"""Public package entrypoints for twitch-vizer."""

from collections.abc import Awaitable
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .config import Settings


def run(settings: "Settings | None" = None) -> Awaitable[None]:
    """Return the application coroutine without importing runtime dependencies early."""
    from .runtime import run as runtime_run

    return runtime_run(settings)


def main() -> None:
    """CLI entrypoint used by the package script and backend/main.py."""
    from .runtime import main as runtime_main

    runtime_main()
