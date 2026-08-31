import asyncio
import unittest
from types import SimpleNamespace
from unittest import mock

from vizer import bot as bot_module
from vizer.bot import (
    VizBot,
    _fragment_emote_url,
    _message_parts_from_fragments,
    get_user_id,
)
from vizer.config import TwitchCredentials
from vizer.handler import MessageKind, QueuedMessage


class BotFragmentParsingTest(unittest.TestCase):
    def test_extracts_eventsub_dict_emote_fragment(self) -> None:
        text, emotes, parts = _message_parts_from_fragments(
            [
                {"type": "text", "text": "hello "},
                {"type": "emote", "text": "Kappa", "emote": {"id": "25"}},
                {"type": "text", "text": " world"},
            ],
        )

        self.assertEqual(text, "hello  world")
        self.assertEqual(emotes, ["Kappa"])
        self.assertEqual([part.type for part in parts], ["text", "image", "text"])
        self.assertEqual(parts[1].name, "Kappa")
        self.assertEqual(
            parts[1].url,
            "https://static-cdn.jtvnw.net/emoticons/v2/25/static/dark/3.0",
        )
        self.assertEqual(
            parts[1].animated_url,
            "https://static-cdn.jtvnw.net/emoticons/v2/25/animated/dark/3.0",
        )
        self.assertEqual(parts[1].static_url, parts[1].url)

    def test_extracts_object_fragment_with_enum_like_type(self) -> None:
        emote_type = SimpleNamespace(value="emote")
        fragment = SimpleNamespace(
            type=emote_type,
            text="PogChamp",
            emote=SimpleNamespace(id="305954156"),
        )

        text, emotes, parts = _message_parts_from_fragments([fragment])

        self.assertEqual(text, "")
        self.assertEqual(emotes, ["PogChamp"])
        self.assertEqual(parts[0].url, _fragment_emote_url(fragment))
        self.assertIn("/static/dark/3.0", parts[0].url)

    def test_falls_back_to_payload_text_without_fragments(self) -> None:
        text, emotes, parts = _message_parts_from_fragments(
            [], fallback_text="plain chat"
        )

        self.assertEqual(text, "plain chat")
        self.assertEqual(emotes, [])
        self.assertEqual(parts[0].text, "plain chat")

    def test_normalizes_animated_emote_url_to_static(self) -> None:
        fragment = {
            "type": "emote",
            "text": "Dance",
            "emote": {
                "images": {
                    "url_4x": "https://static-cdn.jtvnw.net/emoticons/v2/1/animated/dark/3.0"
                }
            },
        }

        self.assertEqual(
            _fragment_emote_url(fragment),
            "https://static-cdn.jtvnw.net/emoticons/v2/1/static/dark/3.0",
        )


class RedemptionEventTest(unittest.TestCase):
    def _bot_with_queue(self) -> tuple[VizBot, asyncio.Queue[QueuedMessage]]:
        # Bypass AutoBot.__init__ (it opens network resources); the handler
        # under test only touches _message_queue and _display_name.
        bot = VizBot.__new__(VizBot)
        queue: asyncio.Queue[QueuedMessage] = asyncio.Queue()
        bot._message_queue = queue
        return bot, queue

    def test_enqueues_redemption_with_reward_data(self) -> None:
        bot, queue = self._bot_with_queue()
        payload = SimpleNamespace(
            user=SimpleNamespace(name="viewer"),
            reward=SimpleNamespace(title="Hydrate!", cost=500),
            user_input="cheers",
        )

        asyncio.run(bot.event_custom_redemption_add(payload))  # type: ignore[arg-type]

        message = queue.get_nowait()
        self.assertEqual(message.kind, MessageKind.SYSTEM)
        self.assertEqual(message.system_event, "redemption")
        self.assertEqual(message.username, "viewer")
        self.assertEqual(
            message.system_data,
            {"reward": "Hydrate!", "cost": 500, "input": "cheers"},
        )

    def test_omits_input_when_reward_takes_none(self) -> None:
        bot, queue = self._bot_with_queue()
        payload = SimpleNamespace(
            user=SimpleNamespace(name="viewer"),
            reward=SimpleNamespace(title="Hydrate!", cost=500),
            user_input="",
        )

        asyncio.run(bot.event_custom_redemption_add(payload))  # type: ignore[arg-type]

        message = queue.get_nowait()
        self.assertEqual(message.system_data, {"reward": "Hydrate!", "cost": 500})


class GetUserIdTest(unittest.TestCase):
    def test_login_does_not_touch_the_token_file(self) -> None:
        login_kwargs: dict[str, object] = {}

        class FakeClient:
            def __init__(self, **_: object) -> None:
                pass

            async def __aenter__(self) -> "FakeClient":
                return self

            async def __aexit__(self, *_: object) -> None:
                return None

            async def login(self, **kwargs: object) -> None:
                login_kwargs.update(kwargs)

            async def fetch_users(self, *, logins: list[str]) -> list[SimpleNamespace]:
                return [SimpleNamespace(id="4242", name=logins[0])]

        credentials = TwitchCredentials(client_id="cid", client_secret="secret")
        with mock.patch.object(bot_module, "Client", FakeClient):
            user_id = asyncio.run(get_user_id("streamer", credentials))

        self.assertEqual(user_id, "4242")
        self.assertEqual(login_kwargs, {"load_tokens": False, "save_tokens": False})


if __name__ == "__main__":
    unittest.main()
