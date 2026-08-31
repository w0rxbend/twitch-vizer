import json
import tempfile
import unittest
import unittest.mock
import urllib.parse
import webbrowser
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from twitchio.authentication import OAuth
from twitchio.exceptions import HTTPException

from vizer import oauth_setup
from vizer.config import (
    OAuthSettings,
    ServerSettings,
    Settings,
    TwitchCredentials,
)
from vizer.oauth_setup import (
    VIZER_SCOPE_NAMES,
    build_authorization_url,
    ensure_authorized,
    read_token_entries,
    resolve_stored_bot_id,
    write_bot_id_sidecar,
)


def _http_error(status: int) -> HTTPException:
    return HTTPException("boom", status=status, extra="")


class StubOAuth:
    """OAuth double: scripted validate/refresh outcomes, no network."""

    def __init__(
        self,
        *,
        validate_error: HTTPException | None = None,
        refresh_error: HTTPException | None = None,
        **_: Any,
    ) -> None:
        self.validate_error = validate_error
        self.refresh_error = refresh_error
        self.authorize_kwargs: dict[str, Any] = {}
        self.validated: list[str] = []
        self.refreshed: list[str] = []
        self.closed = False

    async def validate_token(self, token: str, /) -> Any:
        self.validated.append(token)
        if self.validate_error is not None:
            raise self.validate_error
        return SimpleNamespace(user_id="123", login="somebot")

    async def refresh_token(self, refresh: str, /) -> Any:
        self.refreshed.append(refresh)
        if self.refresh_error is not None:
            raise self.refresh_error
        return SimpleNamespace(access_token="new-token", refresh_token="new-refresh")

    def get_authorization_url(self, **kwargs: Any) -> Any:
        self.authorize_kwargs = kwargs
        return SimpleNamespace(url="https://id.twitch.tv/oauth2/authorize?stub=1")

    async def close(self) -> None:
        self.closed = True


class StubAdapter:
    def __init__(self, **kwargs: Any) -> None:
        self.kwargs = kwargs
        self.ran = False

    async def run(self) -> None:
        self.ran = True


class StubClient:
    """Client double that immediately 'authorizes' user 123 on wait_for."""

    def __init__(self, **kwargs: Any) -> None:
        self.kwargs = kwargs
        self.login_kwargs: dict[str, Any] = {}
        self.login_error: HTTPException | None = None
        self.added_tokens: list[tuple[str, str]] = []

    async def __aenter__(self) -> "StubClient":
        return self

    async def __aexit__(self, *_: Any) -> None:
        return None

    async def login(self, **kwargs: Any) -> None:
        self.login_kwargs = kwargs
        if self.login_error is not None:
            raise self.login_error

    async def wait_for(self, event: str, **_: Any) -> Any:
        assert event == "oauth_authorized"
        return SimpleNamespace(
            access_token="browser-token", refresh_token="browser-refresh", user_id="123"
        )

    async def add_token(self, token: str, refresh: str) -> Any:
        self.added_tokens.append((token, refresh))
        return SimpleNamespace(user_id="123")

    async def save_tokens(self, path: str | None = None, /) -> None:
        # twitchio's save rewrites the whole file from the client's own token
        # map, which would drop other broadcasters; the flow must not use it.
        raise AssertionError(f"save_tokens must not be called (path {path!r})")


def _fail_open(url: str) -> bool:
    raise AssertionError(f"browser flow should not run (tried to open {url!r})")


class AuthorizationUrlTest(unittest.TestCase):
    def test_url_targets_twitch_with_all_scopes_and_redirect(self) -> None:
        oauth = OAuth(client_id="cid", client_secret="secret")

        url = build_authorization_url(oauth, "http://localhost:4343/oauth/callback")

        self.assertTrue(url.startswith("https://id.twitch.tv/oauth2/authorize"))
        parsed = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
        self.assertEqual(parsed["client_id"], ["cid"])
        self.assertEqual(parsed["response_type"], ["code"])
        self.assertEqual(
            urllib.parse.unquote(parsed["redirect_uri"][0]),
            "http://localhost:4343/oauth/callback",
        )
        granted = set(urllib.parse.unquote(parsed["scope"][0]).split())
        self.assertEqual(granted, set(VIZER_SCOPE_NAMES))

    def test_url_uses_configured_redirect_url(self) -> None:
        oauth = OAuth(client_id="cid", client_secret="secret")

        url = build_authorization_url(oauth, "https://vizer.example.org/oauth/callback")

        parsed = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
        self.assertEqual(
            urllib.parse.unquote(parsed["redirect_uri"][0]),
            "https://vizer.example.org/oauth/callback",
        )


class ResolveStoredBotIdTest(unittest.TestCase):
    def test_sidecar_wins_in_multi_user_file(self) -> None:
        entries = {"1": {}, "2": {}}
        self.assertEqual(resolve_stored_bot_id(entries, "2"), "2")

    def test_single_entry_needs_no_sidecar(self) -> None:
        self.assertEqual(resolve_stored_bot_id({"7": {}}, None), "7")

    def test_stale_sidecar_is_ignored(self) -> None:
        self.assertEqual(resolve_stored_bot_id({"7": {}}, "999"), "7")

    def test_ambiguous_file_resolves_to_none(self) -> None:
        self.assertIsNone(resolve_stored_bot_id({"1": {}, "2": {}}, None))


class EnsureAuthorizedTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.token_file = str(Path(tmp.name) / "tokens.json")
        self.sidecar = Path(f"{self.token_file}.bot_id")

    def _settings(self, bot_username: str | None = None) -> Settings:
        return Settings(
            twitch=TwitchCredentials(client_id="cid", client_secret="secret"),
            bot_username=bot_username,
            server=ServerSettings(host="127.0.0.1", port=8080),
            oauth=OAuthSettings(
                host="localhost",
                port=4343,
                redirect_url="http://localhost:4343/oauth/callback",
            ),
            emotes_db_path="",
            token_file=self.token_file,
            log_level="INFO",
        )

    def _write_entries(self, entries: dict[str, dict[str, str]]) -> None:
        Path(self.token_file).write_text(json.dumps(entries), encoding="utf-8")

    def _entry(self, user_id: str = "123") -> dict[str, str]:
        return {"user_id": user_id, "token": "tok", "refresh": "ref"}

    async def test_missing_token_file_runs_browser_flow(self) -> None:
        opened: list[str] = []
        clients: list[StubClient] = []
        adapters: list[StubAdapter] = []

        def client_factory(**kwargs: Any) -> StubClient:
            client = StubClient(**kwargs)
            clients.append(client)
            return client

        def adapter_factory(**kwargs: Any) -> StubAdapter:
            adapter = StubAdapter(**kwargs)
            adapters.append(adapter)
            return adapter

        bot_id = await ensure_authorized(
            self._settings(),
            client_factory=client_factory,  # type: ignore[arg-type]
            adapter_factory=adapter_factory,  # type: ignore[arg-type]
            open_browser=lambda url: opened.append(url) is None,
        )

        self.assertEqual(bot_id, "123")
        (client,) = clients
        (adapter,) = adapters
        self.assertTrue(adapter.ran)
        self.assertEqual(
            adapter.kwargs, {"host": "localhost", "port": 4343, "domain": None}
        )
        self.assertEqual(
            client.login_kwargs, {"load_tokens": False, "save_tokens": False}
        )
        self.assertEqual(client.added_tokens, [("browser-token", "browser-refresh")])
        self.assertEqual(
            read_token_entries(self.token_file)["123"]["token"], "browser-token"
        )
        self.assertEqual(self.sidecar.read_text().strip(), "123")
        self.assertEqual(len(opened), 1)
        self.assertIn("id.twitch.tv/oauth2/authorize", opened[0])

    async def test_login_rejection_names_the_credential_variables(self) -> None:
        # A 400/401/403 from the app-token fetch means Twitch rejected the
        # client id/secret; the flow must fail with actionable guidance
        # instead of twitchio's raw HTTPException, and before serving the
        # callback adapter.
        adapters: list[StubAdapter] = []

        def client_factory(**kwargs: Any) -> StubClient:
            client = StubClient(**kwargs)
            client.login_error = _http_error(400)
            return client

        def adapter_factory(**kwargs: Any) -> StubAdapter:
            adapter = StubAdapter(**kwargs)
            adapters.append(adapter)
            return adapter

        with self.assertRaisesRegex(RuntimeError, "TWITCH_CLIENT_ID"):
            await ensure_authorized(
                self._settings(),
                client_factory=client_factory,  # type: ignore[arg-type]
                adapter_factory=adapter_factory,  # type: ignore[arg-type]
                open_browser=lambda url: True,
            )
        (adapter,) = adapters
        self.assertFalse(adapter.ran)

    async def test_valid_stored_token_skips_browser(self) -> None:
        self._write_entries({"123": self._entry()})
        oauth = StubOAuth()

        bot_id = await ensure_authorized(
            self._settings(),
            oauth_factory=lambda **kwargs: oauth,  # type: ignore[arg-type,return-value]
            open_browser=_fail_open,
        )

        self.assertEqual(bot_id, "123")
        self.assertEqual(oauth.validated, ["tok"])
        self.assertTrue(oauth.closed)
        # Sidecar backfilled for pre-existing token files that lack one.
        self.assertEqual(self.sidecar.read_text().strip(), "123")

    async def test_expired_token_is_refreshed_and_rewritten(self) -> None:
        self._write_entries({"123": self._entry()})
        oauth = StubOAuth(validate_error=_http_error(401))

        bot_id = await ensure_authorized(
            self._settings(),
            oauth_factory=lambda **kwargs: oauth,  # type: ignore[arg-type,return-value]
            open_browser=_fail_open,
        )

        self.assertEqual(bot_id, "123")
        self.assertEqual(oauth.refreshed, ["ref"])
        rewritten = read_token_entries(self.token_file)
        self.assertEqual(rewritten["123"]["token"], "new-token")
        self.assertEqual(rewritten["123"]["refresh"], "new-refresh")

    async def test_dead_refresh_token_falls_back_to_browser(self) -> None:
        self._write_entries({"123": self._entry()})
        oauth = StubOAuth(
            validate_error=_http_error(401), refresh_error=_http_error(401)
        )

        def open_browser(url: str) -> bool:
            # A headless host raising is part of the contract under test.
            raise webbrowser.Error("no browser")

        bot_id = await ensure_authorized(
            self._settings(),
            oauth_factory=lambda **kwargs: oauth,  # type: ignore[arg-type,return-value]
            client_factory=StubClient,  # type: ignore[arg-type]
            adapter_factory=StubAdapter,  # type: ignore[arg-type]
            open_browser=open_browser,
        )

        self.assertEqual(bot_id, "123")
        self.assertEqual(
            read_token_entries(self.token_file)["123"]["token"], "browser-token"
        )

    async def test_non_401_validate_error_propagates(self) -> None:
        self._write_entries({"123": self._entry()})
        oauth = StubOAuth(validate_error=_http_error(500))

        with self.assertRaises(HTTPException):
            await ensure_authorized(
                self._settings(),
                oauth_factory=lambda **kwargs: oauth,  # type: ignore[arg-type,return-value]
                open_browser=_fail_open,
            )
        self.assertTrue(oauth.closed)

    async def test_server_side_refresh_error_propagates(self) -> None:
        # A Twitch outage on /oauth2/token is not evidence the refresh token
        # is dead, so startup must fail instead of re-authorizing.
        self._write_entries({"123": self._entry()})
        oauth = StubOAuth(
            validate_error=_http_error(401), refresh_error=_http_error(503)
        )

        with self.assertRaises(HTTPException):
            await ensure_authorized(
                self._settings(),
                oauth_factory=lambda **kwargs: oauth,  # type: ignore[arg-type,return-value]
                open_browser=_fail_open,
            )
        self.assertTrue(oauth.closed)
        self.assertEqual(read_token_entries(self.token_file)["123"]["refresh"], "ref")

    async def test_refreshed_entry_without_user_id_uses_the_map_key(self) -> None:
        self._write_entries({"123": {"token": "tok", "refresh": "ref"}})
        oauth = StubOAuth(validate_error=_http_error(401))

        await ensure_authorized(
            self._settings(),
            oauth_factory=lambda **kwargs: oauth,  # type: ignore[arg-type,return-value]
            open_browser=_fail_open,
        )

        self.assertEqual(read_token_entries(self.token_file)["123"]["user_id"], "123")

    async def test_browser_flow_keeps_other_broadcaster_entries(self) -> None:
        self._write_entries({"999": self._entry("999")})
        write_bot_id_sidecar(self.token_file, "123")
        oauth = StubOAuth(
            validate_error=_http_error(401), refresh_error=_http_error(401)
        )
        self._write_entries({"999": self._entry("999"), "123": self._entry("123")})

        bot_id = await ensure_authorized(
            self._settings(),
            oauth_factory=lambda **kwargs: oauth,  # type: ignore[arg-type,return-value]
            client_factory=StubClient,  # type: ignore[arg-type]
            adapter_factory=StubAdapter,  # type: ignore[arg-type]
            open_browser=lambda url: True,
        )

        self.assertEqual(bot_id, "123")
        entries = read_token_entries(self.token_file)
        self.assertEqual(entries["123"]["token"], "browser-token")
        self.assertEqual(entries["999"]["token"], "tok")

    async def test_multi_user_file_without_sidecar_raises(self) -> None:
        self._write_entries({"1": self._entry("1"), "2": self._entry("2")})

        with self.assertRaises(RuntimeError):
            await ensure_authorized(self._settings(), open_browser=_fail_open)

    async def test_sidecar_selects_entry_in_multi_user_file(self) -> None:
        self._write_entries({"1": self._entry("1"), "2": self._entry("2")})
        write_bot_id_sidecar(self.token_file, "2")
        oauth = StubOAuth()

        bot_id = await ensure_authorized(
            self._settings(),
            oauth_factory=lambda **kwargs: oauth,  # type: ignore[arg-type,return-value]
            open_browser=_fail_open,
        )

        self.assertEqual(bot_id, "2")

    async def test_username_override_resolves_multi_user_file(self) -> None:
        self._write_entries({"1": self._entry("1"), "2": self._entry("2")})
        oauth = StubOAuth()

        async def resolve_user_id(username: str, credentials: Any) -> str:
            self.assertEqual(username, "somebot")
            return "2"

        bot_id = await ensure_authorized(
            self._settings(bot_username="somebot"),
            oauth_factory=lambda **kwargs: oauth,  # type: ignore[arg-type,return-value]
            open_browser=_fail_open,
            resolve_user_id=resolve_user_id,
        )

        self.assertEqual(bot_id, "2")
        self.assertEqual(self.sidecar.read_text().strip(), "2")

    async def test_browser_flow_builds_url_with_injected_oauth(self) -> None:
        oauth = StubOAuth()
        opened: list[str] = []

        await ensure_authorized(
            self._settings(),
            oauth_factory=lambda **kwargs: oauth,  # type: ignore[arg-type,return-value]
            client_factory=StubClient,  # type: ignore[arg-type]
            adapter_factory=StubAdapter,  # type: ignore[arg-type]
            open_browser=lambda url: opened.append(url) is None,
        )

        self.assertEqual(opened, ["https://id.twitch.tv/oauth2/authorize?stub=1"])
        self.assertEqual(
            oauth.authorize_kwargs["redirect_uri"],
            "http://localhost:4343/oauth/callback",
        )
        self.assertTrue(oauth.closed)

    async def test_unwritable_sidecar_fails_browser_flow_with_hint(self) -> None:
        def failing_write(*_: Any, **__: Any) -> None:
            raise OSError("read-only file system")

        with unittest.mock.patch.object(oauth_setup, "_write_atomic", failing_write):
            with self.assertRaisesRegex(RuntimeError, "VIZER_TOKEN_FILE"):
                await ensure_authorized(
                    self._settings(),
                    client_factory=StubClient,  # type: ignore[arg-type]
                    adapter_factory=StubAdapter,  # type: ignore[arg-type]
                    open_browser=lambda url: True,
                )

    async def test_unwritable_token_file_still_returns_refreshed_bot_id(self) -> None:
        self._write_entries({"123": self._entry()})
        oauth = StubOAuth(validate_error=_http_error(401))

        def failing_write(*_: Any, **__: Any) -> None:
            raise OSError("read-only file system")

        with unittest.mock.patch.object(oauth_setup, "_write_atomic", failing_write):
            bot_id = await ensure_authorized(
                self._settings(),
                oauth_factory=lambda **kwargs: oauth,  # type: ignore[arg-type,return-value]
                open_browser=_fail_open,
            )

        self.assertEqual(bot_id, "123")

    async def test_corrupt_token_file_runs_browser_flow(self) -> None:
        Path(self.token_file).write_text("not json", encoding="utf-8")

        bot_id = await ensure_authorized(
            self._settings(),
            client_factory=StubClient,  # type: ignore[arg-type]
            adapter_factory=StubAdapter,  # type: ignore[arg-type]
            open_browser=lambda url: True,
        )

        self.assertEqual(bot_id, "123")


if __name__ == "__main__":
    unittest.main()
