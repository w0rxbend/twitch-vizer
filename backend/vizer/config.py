"""Environment-variable configuration for twitch-vizer.

All runtime settings are read from environment variables (populated from a
.env file via python-dotenv).  Module-level constants are set at import time
so that any misconfiguration surfaces immediately on startup rather than at
the first use of a value.

Required variables raise RuntimeError if missing.
Optional variables fall back to sensible defaults.
"""

import os

from dotenv import load_dotenv

# Load .env into os.environ before any _require() call reads from it.
# Has no effect if the file does not exist (harmless in Docker/CI).
load_dotenv()


def _require(key: str) -> str:
    """Read a required environment variable, raising clearly if it is absent."""
    value = os.getenv(key)
    if value is None:
        raise RuntimeError(f"Required environment variable {key!r} is not set")
    return value


# ── Twitch API credentials (all required) ────────────────────────────────────
CLIENT_ID: str     = _require("TWITCH_CLIENT_ID")
CLIENT_SECRET: str = _require("TWITCH_CLIENT_SECRET")
ACCESS_TOKEN: str  = _require("TWITCH_ACCESS_TOKEN")
REFRESH_TOKEN: str = _require("TWITCH_REFRESH_TOKEN")
BOT_USERNAME: str  = str(os.getenv("TWITCH_BOT_USERNAME", "worxbend"))

# ── HTTP / WebSocket server ───────────────────────────────────────────────────
SERVER_HOST: str = str(os.getenv("VIZER_SERVER_HOST", "0.0.0.0"))
SERVER_PORT: int = int(os.getenv("VIZER_SERVER_PORT", "8080"))

# ── Logging ───────────────────────────────────────────────────────────────────
LOG_LEVEL: str = str(os.getenv("VIZER_LOG_LEVEL", "INFO")).upper()
