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
from urllib.parse import urlsplit

from dotenv import load_dotenv


OAUTH_BASE_PATH = "/oauth"
OAUTH_CALLBACK_PATH = f"{OAUTH_BASE_PATH}/callback"

_LOG_LEVELS = frozenset({"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"})


@dataclass(frozen=True)
class TwitchCredentials:
    """Twitch application credentials used by TwitchIO.

    User OAuth tokens are not part of the configuration: they are obtained
    through the browser authorization flow on first run and persisted to the
    token file afterwards (see ``oauth_setup.py``).
    """

    client_id: str
    client_secret: str


@dataclass(frozen=True)
class ServerSettings:
    """HTTP/WebSocket bind settings."""

    host: str
    port: int


@dataclass(frozen=True)
class OAuthSettings:
    """Bind settings for the TwitchIO OAuth web adapter.

    ``redirect_url`` must byte-for-byte match the redirect URL registered for
    the application in the Twitch developer console.  By default it is
    ``http://localhost:<port>/oauth/callback``; deployments that expose the
    callback through a domain or reverse proxy override it with
    ``OAUTH_REDIRECT_URL``.
    """

    host: str
    port: int
    redirect_url: str

    @property
    def domain(self) -> str | None:
        """External domain for the OAuth adapter, or None for localhost.

        TwitchIO's web adapter builds the code-exchange redirect URI from this
        domain (over https), so it must be set whenever the registered
        redirect URL is not localhost.
        """
        parts = urlsplit(self.redirect_url)
        if parts.hostname in (None, "localhost", "127.0.0.1"):
            return None
        return parts.netloc

    @property
    def authorize_helper_url(self) -> str:
        """URL of the page that redirects the operator to Twitch's consent screen.

        It is the callback URL with the ``/callback`` leaf removed, which is
        always well-formed because the redirect URL is validated to end with
        ``OAUTH_CALLBACK_PATH``.
        """
        return self.redirect_url.removesuffix(OAUTH_CALLBACK_PATH) + OAUTH_BASE_PATH


@dataclass(frozen=True)
class Settings:
    """Validated application settings."""

    twitch: TwitchCredentials
    bot_username: str | None
    server: ServerSettings
    oauth: OAuthSettings
    emotes_db_path: str
    token_file: str
    log_level: str


def _require(env: Mapping[str, str], key: str) -> str:
    """Read a required environment variable, raising clearly if it is absent."""
    value = env.get(key)
    if not value:
        raise RuntimeError(f"Required environment variable {key!r} is not set")
    return value


_DEFAULT_EMOTES_DB_PATH = Path(__file__).resolve().parents[1] / "emotes" / "emotes.db"


def _read_port(env: Mapping[str, str], key: str, default: int) -> int:
    raw_port = env.get(key, str(default))
    try:
        return int(raw_port)
    except ValueError as exc:
        raise RuntimeError(f"{key} must be an integer") from exc


def _read_log_level(env: Mapping[str, str]) -> str:
    level = env.get("VIZER_LOG_LEVEL", "INFO").upper()
    if level not in _LOG_LEVELS:
        raise RuntimeError(
            f"VIZER_LOG_LEVEL must be one of {', '.join(sorted(_LOG_LEVELS))}, "
            f"got {level!r}"
        )
    return level


def _load_oauth_settings(environ: Mapping[str, str]) -> OAuthSettings:
    # localhost matches twitchio's adapter default. Containers set 0.0.0.0 so
    # the callback is reachable through a port mapping.
    host = environ.get("VIZER_OAUTH_HOST", "localhost")
    port = _read_port(environ, "VIZER_OAUTH_PORT", 4343)
    # The default stays on localhost regardless of the bind host: Twitch only
    # accepts plain-http redirect URLs for localhost.
    redirect_url = (
        environ.get("OAUTH_REDIRECT_URL")
        or f"http://localhost:{port}{OAUTH_CALLBACK_PATH}"
    )
    # TwitchIO serves the callback at exactly /oauth/callback, and the URL in
    # the authorize request must byte-for-byte match the one used during the
    # code exchange — any other path can never complete authorization.
    if not redirect_url.endswith(OAUTH_CALLBACK_PATH):
        raise RuntimeError(
            f"OAUTH_REDIRECT_URL must end with {OAUTH_CALLBACK_PATH!r}, "
            f"got {redirect_url!r}"
        )
    return OAuthSettings(host=host, port=port, redirect_url=redirect_url)


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
        ),
        # Optional. Only consulted as a tie-breaker when a token file created
        # before the bot-id sidecar existed contains several users' tokens.
        bot_username=environ.get("TWITCH_BOT_USERNAME") or None,
        server=ServerSettings(
            # Localhost-only by default: the overlay endpoints have no auth.
            # Deployments that need LAN access set VIZER_SERVER_HOST=0.0.0.0.
            host=environ.get("VIZER_SERVER_HOST", "127.0.0.1"),
            port=_read_port(environ, "VIZER_SERVER_PORT", 8080),
        ),
        oauth=_load_oauth_settings(environ),
        emotes_db_path=environ.get(
            "VIZER_EMOTES_DB_PATH",
            str(_DEFAULT_EMOTES_DB_PATH),
        ),
        # Where twitchio persists refreshed OAuth tokens; containers point this
        # at a mounted volume so refreshed tokens survive redeploys.
        token_file=environ.get("VIZER_TOKEN_FILE", ".tio.tokens.json"),
        log_level=_read_log_level(environ),
    )
