"""Environment-variable configuration for twitch-vizer.

The configuration module owns reading process environment, but it does not
export mutable/global runtime values.  The composition root calls
``load_settings()`` once and injects the resulting settings into the rest of
the application.
"""

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class TwitchCredentials:
    """OAuth/application credentials used by TwitchIO."""

    client_id: str
    client_secret: str
    access_token: str
    refresh_token: str


@dataclass(frozen=True)
class ServerSettings:
    """HTTP/WebSocket bind settings."""

    host: str
    port: int


@dataclass(frozen=True)
class Settings:
    """Validated application settings."""

    twitch: TwitchCredentials
    bot_username: str
    server: ServerSettings
    emotes_db_path: str
    log_level: str


def _require(env: Mapping[str, str], key: str) -> str:
    """Read a required environment variable, raising clearly if it is absent."""
    value = env.get(key)
    if not value:
        raise RuntimeError(f"Required environment variable {key!r} is not set")
    return value


_DEFAULT_EMOTES_DB_PATH = Path(__file__).resolve().parents[1] / "emotes" / "emotes.db"


def _read_port(env: Mapping[str, str]) -> int:
    raw_port = env.get("VIZER_SERVER_PORT", "8080")
    try:
        return int(raw_port)
    except ValueError as exc:
        raise RuntimeError("VIZER_SERVER_PORT must be an integer") from exc


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    """Load and validate application settings from environment variables."""
    if env is None:
        load_dotenv()
        environ = os.environ
    else:
        environ = env

    return Settings(
        twitch=TwitchCredentials(
            client_id=_require(environ, "TWITCH_CLIENT_ID"),
            client_secret=_require(environ, "TWITCH_CLIENT_SECRET"),
            access_token=_require(environ, "TWITCH_ACCESS_TOKEN"),
            refresh_token=_require(environ, "TWITCH_REFRESH_TOKEN"),
        ),
        bot_username=environ.get("TWITCH_BOT_USERNAME", "worxbend"),
        server=ServerSettings(
            host=environ.get("VIZER_SERVER_HOST", "0.0.0.0"),
            port=_read_port(environ),
        ),
        emotes_db_path=environ.get(
            "VIZER_EMOTES_DB_PATH",
            str(_DEFAULT_EMOTES_DB_PATH),
        ),
        log_level=environ.get("VIZER_LOG_LEVEL", "INFO").upper(),
    )
