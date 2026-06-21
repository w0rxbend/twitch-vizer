import unittest
from types import SimpleNamespace

from vizer.bot import _fragment_emote_url, _message_parts_from_fragments


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
        text, emotes, parts = _message_parts_from_fragments([], fallback_text="plain chat")

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


if __name__ == "__main__":
    unittest.main()
