import unittest

from vizer.config import load_settings

_REQUIRED_ENV = {
    "TWITCH_CLIENT_ID": "client-id",
    "TWITCH_CLIENT_SECRET": "client-secret",
    "TWITCH_ACCESS_TOKEN": "access-token",
    "TWITCH_REFRESH_TOKEN": "refresh-token",
    "TWITCH_BOT_USERNAME": "somebot",
}


class LoadSettingsTest(unittest.TestCase):
    def test_loads_required_values_and_defaults(self) -> None:
        settings = load_settings(_REQUIRED_ENV)

        self.assertEqual(settings.twitch.client_id, "client-id")
        self.assertEqual(settings.bot_username, "somebot")
        self.assertEqual(settings.server.host, "127.0.0.1")
        self.assertEqual(settings.server.port, 8080)
        self.assertEqual(settings.token_file, ".tio.tokens.json")
        self.assertEqual(settings.log_level, "INFO")

    def test_missing_required_variable_raises(self) -> None:
        for key in _REQUIRED_ENV:
            env = {k: v for k, v in _REQUIRED_ENV.items() if k != key}
            with self.assertRaises(RuntimeError, msg=key):
                load_settings(env)

    def test_empty_required_variable_raises(self) -> None:
        env = _REQUIRED_ENV | {"TWITCH_BOT_USERNAME": ""}
        with self.assertRaises(RuntimeError):
            load_settings(env)

    def test_non_integer_port_raises(self) -> None:
        env = _REQUIRED_ENV | {"VIZER_SERVER_PORT": "not-a-port"}
        with self.assertRaises(RuntimeError):
            load_settings(env)

    def test_overrides_are_applied(self) -> None:
        env = _REQUIRED_ENV | {
            "VIZER_SERVER_HOST": "0.0.0.0",
            "VIZER_SERVER_PORT": "9000",
            "VIZER_TOKEN_FILE": "/data/.tio.tokens.json",
            "VIZER_LOG_LEVEL": "debug",
        }

        settings = load_settings(env)

        self.assertEqual(settings.server.host, "0.0.0.0")
        self.assertEqual(settings.server.port, 9000)
        self.assertEqual(settings.token_file, "/data/.tio.tokens.json")
        self.assertEqual(settings.log_level, "DEBUG")


if __name__ == "__main__":
    unittest.main()
