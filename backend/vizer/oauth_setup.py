"""First-run OAuth bootstrap for twitch-vizer.

TwitchIO's AutoBot needs the bot's Twitch user ID and a user OAuth token
before it can subscribe to any EventSub topic, but neither exists until a
human has authorized the application once in a browser.  ``ensure_authorized``
resolves that chicken-and-egg problem at startup:

1. If the token file already holds a working (or refreshable) token, return
   the stored bot user ID without any user interaction.
2. Otherwise serve twitchio's OAuth routes on a temporary web adapter, log the
   Twitch authorization URL (and try to open a browser), and wait for the
   user to approve.  The resulting token is validated by Twitch, which also
   tells us the user ID — no configured username needed.

The bot's user ID is remembered in a sidecar file next to the token file
(``<token_file>.bot_id``) because the token file itself is keyed by user ID
and may in principle hold tokens for several users (broadcasters can
authorize additional channels through the running bot's ``/oauth`` route).
"""

import json
import logging
import os
import tempfile
import webbrowser
from collections.abc import Awaitable, Callable
from datetime import datetime
from pathlib import Path
from typing import Any, NamedTuple

from twitchio import Client, Scopes
from twitchio.authentication import OAuth, UserTokenPayload
from twitchio.exceptions import HTTPException
from twitchio.web import AiohttpAdapter

from .bot import get_user_id
from .config import Settings, TwitchCredentials

LOGGER: logging.Logger = logging.getLogger(__name__)

# One authorization by the bot/broadcaster account must cover every EventSub
# subscription the bot creates.  AutoBot subscribes over Conduits with the app
# token, which is why the chat subscription needs user:bot (chatting user) and
# channel:bot (broadcaster) on top of user:read:chat.
VIZER_SCOPE_NAMES: tuple[str, ...] = (
    "user:read:chat",  # channel.chat.message
    "user:bot",  # chat subscription via app token
    "channel:bot",  # broadcaster side of the chat subscription
    "moderator:read:followers",  # channel.follow
    "channel:read:subscriptions",  # channel.subscribe / gifts / resubs
    "bits:read",  # channel.cheer
    "channel:read:redemptions",  # channel points redemptions
)

TokenEntry = dict[str, str]

# Injection points so unit tests can exercise the flow without the network or
# a real browser; production callers use the defaults.
OAuthFactory = Callable[..., OAuth]
ClientFactory = Callable[..., Client]
AdapterFactory = Callable[..., AiohttpAdapter[Any]]
OpenBrowser = Callable[[str], bool]
ResolveUserId = Callable[[str, TwitchCredentials], Awaitable[str]]


def vizer_scopes() -> Scopes:
    """Return the full set of OAuth scopes the bot requires."""
    return Scopes(list(VIZER_SCOPE_NAMES))


def build_authorization_url(oauth: OAuth, redirect_url: str) -> str:
    """Build the Twitch authorize URL requesting every scope the bot needs.

    ``redirect_url`` comes from ``OAuthSettings.redirect_url`` and must
    byte-for-byte match the redirect URL registered for the application in the
    Twitch developer console.
    """
    payload = oauth.get_authorization_url(
        scopes=vizer_scopes(),
        redirect_uri=redirect_url,
    )
    return payload.url


def _sidecar_path(token_file: str) -> Path:
    return Path(f"{token_file}.bot_id")


def read_bot_id_sidecar(token_file: str) -> str | None:
    """Read the remembered bot user ID, or None when the sidecar is absent."""
    try:
        value = _sidecar_path(token_file).read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return value or None


def _write_atomic(path: Path, text: str) -> None:
    """Replace ``path`` with ``text`` in one step.

    The temp file lives in the target's own directory so ``os.replace`` stays
    on a single filesystem; an interrupted write then leaves the previous
    (still usable) token file untouched instead of a truncated one.
    """
    handle, temp_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            stream.write(text)
        os.replace(temp_name, path)
    except BaseException:
        Path(temp_name).unlink(missing_ok=True)
        raise


def write_bot_id_sidecar(token_file: str, bot_id: str) -> None:
    """Remember which token-file entry belongs to the bot account."""
    _write_atomic(_sidecar_path(token_file), f"{bot_id}\n")


def read_token_entries(token_file: str) -> dict[str, TokenEntry]:
    """Read twitchio's token file ({user_id: {token, refresh, ...}}).

    Returns an empty dict when the file is missing or not in the expected
    shape; the browser flow then rewrites it from scratch.
    """
    try:
        raw = Path(token_file).read_text(encoding="utf-8")
    except OSError:
        return {}
    try:
        data = json.loads(raw)
    except ValueError:
        LOGGER.warning("Token file %r is not valid JSON; ignoring it.", token_file)
        return {}
    if not isinstance(data, dict):
        LOGGER.warning(
            "Token file %r has an unexpected shape; ignoring it.", token_file
        )
        return {}
    entries: dict[str, TokenEntry] = {}
    for user_id, entry in data.items():
        if (
            isinstance(entry, dict)
            and isinstance(entry.get("token"), str)
            and isinstance(entry.get("refresh"), str)
        ):
            entries[str(user_id)] = entry
    return entries


def _write_token_entries(token_file: str, entries: dict[str, TokenEntry]) -> None:
    _write_atomic(Path(token_file), json.dumps(entries))


def resolve_stored_bot_id(
    entries: dict[str, TokenEntry], sidecar_bot_id: str | None
) -> str | None:
    """Pick the bot's entry from the token file without network access.

    Returns None when the file is ambiguous (several users and no matching
    sidecar); the caller then falls back to the optional username override.
    """
    if sidecar_bot_id and sidecar_bot_id in entries:
        return sidecar_bot_id
    if len(entries) == 1:
        return next(iter(entries))
    return None


async def _resolve_bot_id(
    entries: dict[str, TokenEntry],
    sidecar_bot_id: str | None,
    settings: Settings,
    resolve_user_id: ResolveUserId,
) -> str:
    bot_id = resolve_stored_bot_id(entries, sidecar_bot_id)
    if bot_id is not None:
        return bot_id
    if settings.bot_username:
        user_id = await resolve_user_id(settings.bot_username, settings.twitch)
        if user_id in entries:
            return user_id
    raise RuntimeError(
        f"Token file {settings.token_file!r} contains tokens for several users "
        "and none of them could be identified as the bot account. Delete the "
        "file and restart to authorize the bot in the browser again."
    )


class TokenCheck(NamedTuple):
    """Outcome of validating a stored token.

    ``entry`` is None when the refresh token is dead and the user has to
    re-authorize in the browser; ``refreshed`` marks the entry as a new one the
    caller must persist.
    """

    entry: TokenEntry | None
    refreshed: bool


async def _validate_stored_token(
    oauth: OAuth, user_id: str, entry: TokenEntry
) -> TokenCheck:
    """Check a stored token against Twitch, refreshing it when expired."""
    try:
        await oauth.validate_token(entry["token"])
        return TokenCheck(entry, False)
    except HTTPException as exc:
        # Anything but 401 (e.g. a Twitch outage) is not evidence the token is
        # bad, so fail startup instead of discarding a working refresh token.
        if exc.status != 401:
            raise
    try:
        refreshed = await oauth.refresh_token(entry["refresh"])
    except HTTPException as exc:
        # A server-side failure (Twitch outage) says nothing about the refresh
        # token; only a 4xx means Twitch rejected it.
        if exc.status >= 500:
            raise
        return TokenCheck(None, False)
    return TokenCheck(
        {
            "user_id": user_id,
            "token": refreshed.access_token,
            "refresh": refreshed.refresh_token,
            "last_validated": datetime.now().isoformat(),
        },
        True,
    )


async def _authorize_via_browser(
    settings: Settings,
    *,
    oauth_factory: OAuthFactory,
    client_factory: ClientFactory,
    adapter_factory: AdapterFactory,
    open_browser: OpenBrowser,
) -> str:
    scopes = vizer_scopes()
    existing = read_token_entries(settings.token_file)
    adapter = adapter_factory(
        host=settings.oauth.host,
        port=settings.oauth.port,
        domain=settings.oauth.domain,
    )
    client = client_factory(
        client_id=settings.twitch.client_id,
        client_secret=settings.twitch.client_secret,
        scopes=scopes,
        adapter=adapter,
    )
    oauth = oauth_factory(
        client_id=settings.twitch.client_id,
        client_secret=settings.twitch.client_secret,
    )
    async with client:
        # Built and logged before login: URL construction needs no network, so
        # the operator sees where to authorize even if the app-token fetch
        # below fails (e.g. wrong credentials, Twitch outage).
        try:
            url = build_authorization_url(oauth, settings.oauth.redirect_url)
        finally:
            await oauth.close()
        helper_url = settings.oauth.authorize_helper_url
        LOGGER.info(
            "No stored Twitch token found. Authorize the bot account in your "
            "browser:\n\n    %s\n\n(or open %s, which redirects to the same "
            "page). The overlay server starts once authorization completes.",
            url,
            helper_url,
        )
        try:
            # save_tokens=False: the client would otherwise write to twitchio's
            # default path on close; we save explicitly to settings.token_file.
            await client.login(load_tokens=False, save_tokens=False)
        except HTTPException as exc:
            hint = (
                "Check TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET."
                if exc.status in (400, 401, 403)
                else "Twitch may be temporarily unavailable; retry shortly."
            )
            raise RuntimeError(
                f"Could not fetch a Twitch app access token (HTTP {exc.status}). {hint}"
            ) from exc
        await adapter.run()
        try:
            opened = open_browser(url)
        except webbrowser.Error:
            opened = False
        if not opened:
            LOGGER.info(
                "Could not open a browser automatically (normal in Docker or "
                "over SSH); open the URL above manually."
            )

        payload: UserTokenPayload = await client.wait_for("oauth_authorized")
        # The client's default oauth_authorized listener also adds the token,
        # but it runs concurrently with this wait_for; add explicitly so the
        # token is guaranteed to be stored before save_tokens below.
        validated = await client.add_token(payload.access_token, payload.refresh_token)
        bot_id = payload.user_id or validated.user_id
        if not bot_id:
            raise RuntimeError(
                "Twitch authorization completed but did not identify a user. "
                "Re-run and authorize while logged in as the bot account."
            )
        # Written here rather than via client.save_tokens: the client was
        # logged in with load_tokens=False, so it holds only this token and its
        # whole-file save would drop every other broadcaster's entry.
        entry: TokenEntry = {
            "user_id": bot_id,
            "token": payload.access_token,
            "refresh": payload.refresh_token,
            "last_validated": datetime.now().isoformat(),
        }
        try:
            _write_token_entries(settings.token_file, {**existing, bot_id: entry})
            write_bot_id_sidecar(settings.token_file, bot_id)
        except OSError as exc:
            raise RuntimeError(
                f"Twitch authorization succeeded but the token could not be "
                f"written to {settings.token_file!r} ({exc}). Point "
                "VIZER_TOKEN_FILE at a writable location and authorize again."
            ) from exc
        LOGGER.info("Authorized as Twitch user %s; token saved.", bot_id)
        return bot_id


async def ensure_authorized(
    settings: Settings,
    *,
    oauth_factory: OAuthFactory = OAuth,
    client_factory: ClientFactory = Client,
    adapter_factory: AdapterFactory = AiohttpAdapter,
    open_browser: OpenBrowser = webbrowser.open,
    resolve_user_id: ResolveUserId = get_user_id,
) -> str:
    """Return the bot's Twitch user ID, running the OAuth flow if needed.

    Tries the persisted token file first (validating, and refreshing expired
    tokens, so a dead token surfaces here rather than as a subscription
    failure later).  When no usable token exists, blocks on the browser
    authorization flow and persists its result before returning.
    """
    entries = read_token_entries(settings.token_file)
    if entries:
        sidecar_bot_id = read_bot_id_sidecar(settings.token_file)
        bot_id = await _resolve_bot_id(
            entries, sidecar_bot_id, settings, resolve_user_id
        )
        oauth = oauth_factory(
            client_id=settings.twitch.client_id,
            client_secret=settings.twitch.client_secret,
        )
        try:
            entry, refreshed = await _validate_stored_token(
                oauth, bot_id, entries[bot_id]
            )
        finally:
            await oauth.close()
        if entry is not None:
            if refreshed:
                entries[bot_id] = entry
                LOGGER.info("Refreshed stored Twitch token for user %s.", bot_id)
            # Persistence here is a convenience: the usable token is already in
            # memory, so an unwritable token file must not fail startup.
            try:
                if refreshed:
                    _write_token_entries(settings.token_file, entries)
                if sidecar_bot_id != bot_id:
                    write_bot_id_sidecar(settings.token_file, bot_id)
            except OSError as exc:
                LOGGER.warning(
                    "Could not persist the Twitch token for user %s to %r (%s); "
                    "it will be refreshed again on the next start.",
                    bot_id,
                    settings.token_file,
                    exc,
                )
            LOGGER.info("Using stored Twitch token for user %s.", bot_id)
            return bot_id
        LOGGER.warning(
            "Stored Twitch token for user %s is invalid and could not be "
            "refreshed; re-authorization is required.",
            bot_id,
        )
    return await _authorize_via_browser(
        settings,
        oauth_factory=oauth_factory,
        client_factory=client_factory,
        adapter_factory=adapter_factory,
        open_browser=open_browser,
    )
