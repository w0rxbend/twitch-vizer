import unittest

from vizer.config import load_settings

_REQUIRED_ENV = {
    "TWITCH_CLIENT_ID": "client-id",
    "TWITCH_CLIENT_SECRET": "client-secret",
}


class LoadSettingsTest(unittest.TestCase):
    def test_loads_required_values_and_defaults(self) -> None:
        settings = load_settings(_REQUIRED_ENV)

        self.assertEqual(settings.twitch.client_id, "client-id")
        self.assertEqual(settings.twitch.client_secret, "client-secret")
        self.assertIsNone(settings.bot_username)
        self.assertEqual(settings.server.host, "127.0.0.1")
        self.assertEqual(settings.server.port, 8080)
        self.assertEqual(settings.oauth.host, "localhost")
        self.assertEqual(settings.oauth.port, 4343)
        self.assertEqual(
            settings.oauth.redirect_url, "http://localhost:4343/oauth/callback"
        )
        self.assertIsNone(settings.oauth.domain)
        self.assertEqual(settings.token_file, ".tio.tokens.json")
        self.assertEqual(settings.log_level, "INFO")

    def test_missing_required_variable_raises(self) -> None:
        for key in _REQUIRED_ENV:
            env = {k: v for k, v in _REQUIRED_ENV.items() if k != key}
            with self.assertRaises(RuntimeError, msg=key):
                load_settings(env)

    def test_empty_required_variable_raises(self) -> None:
        env = _REQUIRED_ENV | {"TWITCH_CLIENT_SECRET": ""}
        with self.assertRaises(RuntimeError):
            load_settings(env)

    def test_bot_username_is_optional_and_blank_reads_as_unset(self) -> None:
        self.assertIsNone(
            load_settings(_REQUIRED_ENV | {"TWITCH_BOT_USERNAME": ""}).bot_username
        )

        settings = load_settings(_REQUIRED_ENV | {"TWITCH_BOT_USERNAME": "somebot"})
        self.assertEqual(settings.bot_username, "somebot")

    def test_non_integer_port_raises(self) -> None:
        for key in ("VIZER_SERVER_PORT", "VIZER_OAUTH_PORT"):
            env = _REQUIRED_ENV | {key: "not-a-port"}
            with self.assertRaises(RuntimeError, msg=key):
                load_settings(env)

    def test_default_redirect_url_follows_oauth_port(self) -> None:
        settings = load_settings(_REQUIRED_ENV | {"VIZER_OAUTH_PORT": "5343"})
        self.assertEqual(
            settings.oauth.redirect_url, "http://localhost:5343/oauth/callback"
        )

    def test_redirect_url_override_sets_external_domain(self) -> None:
        env = _REQUIRED_ENV | {
            "OAUTH_REDIRECT_URL": "https://vizer.example.org/oauth/callback"
        }

        settings = load_settings(env)

        self.assertEqual(
            settings.oauth.redirect_url, "https://vizer.example.org/oauth/callback"
        )
        self.assertEqual(settings.oauth.domain, "vizer.example.org")

    def test_localhost_redirect_url_override_keeps_no_domain(self) -> None:
        env = _REQUIRED_ENV | {
            "OAUTH_REDIRECT_URL": "http://localhost:9999/oauth/callback"
        }
        self.assertIsNone(load_settings(env).oauth.domain)

    def test_redirect_url_with_wrong_path_raises(self) -> None:
        env = _REQUIRED_ENV | {
            "OAUTH_REDIRECT_URL": "https://vizer.example.org/auth/done"
        }
        with self.assertRaises(RuntimeError):
            load_settings(env)

    def test_unknown_log_level_raises(self) -> None:
        env = _REQUIRED_ENV | {"VIZER_LOG_LEVEL": "DEBGU"}
        with self.assertRaises(RuntimeError):
            load_settings(env)

    def test_overrides_are_applied(self) -> None:
        env = _REQUIRED_ENV | {
            "VIZER_SERVER_HOST": "0.0.0.0",
            "VIZER_SERVER_PORT": "9000",
            "VIZER_OAUTH_HOST": "0.0.0.0",
            "VIZER_OAUTH_PORT": "5343",
            "VIZER_TOKEN_FILE": "/data/.tio.tokens.json",
            "VIZER_LOG_LEVEL": "debug",
        }

        settings = load_settings(env)

        self.assertEqual(settings.server.host, "0.0.0.0")
        self.assertEqual(settings.server.port, 9000)
        self.assertEqual(settings.oauth.host, "0.0.0.0")
        self.assertEqual(settings.oauth.port, 5343)
        self.assertEqual(settings.token_file, "/data/.tio.tokens.json")
        self.assertEqual(settings.log_level, "DEBUG")


if __name__ == "__main__":
    unittest.main()
