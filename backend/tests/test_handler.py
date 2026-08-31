import json
import tempfile
import unittest
from pathlib import Path

from vizer.handler import (
    EmoteCatalog,
    EventType,
    MessageContentResolver,
    MessageKind,
    MessagePart,
    QueuedMessage,
    UserVisualIdentity,
    VisualEventFactory,
)


class EmoteCatalogTest(unittest.TestCase):
    def test_resolves_best_cached_url(self) -> None:
        catalog = EmoteCatalog({"Kappa": {"url_2x": "small.png", "url_4x": "big.png"}})

        emote = catalog.resolve("Kappa")

        self.assertIsNotNone(emote)
        assert emote is not None
        self.assertEqual(emote.name, "Kappa")
        self.assertEqual(emote.url, "big.png")

    def test_uses_message_url_when_cache_misses(self) -> None:
        catalog = EmoteCatalog()

        emote = catalog.resolve(
            "Party",
            "https://static-cdn.jtvnw.net/emoticons/v2/1/animated/dark/3.0",
        )

        self.assertIsNotNone(emote)
        assert emote is not None
        self.assertEqual(
            emote.url,
            "https://static-cdn.jtvnw.net/emoticons/v2/1/static/dark/3.0",
        )


class MessageContentResolverTest(unittest.TestCase):
    def test_resolves_text_images_and_deduplicates_named_emotes(self) -> None:
        resolver = MessageContentResolver(
            EmoteCatalog({"Kappa": "kappa.png", "Wave": "wave.png"}),
        )
        message = QueuedMessage(
            username="viewer",
            text="",
            emote_names=["Kappa", "Wave"],
            parts=[
                MessagePart(type="text", text="hello "),
                MessagePart(type="image", name="Kappa"),
            ],
        )

        content = resolver.resolve(message)

        self.assertEqual(content.text, "hello")
        self.assertEqual(
            [part.type for part in content.parts], ["text", "image", "image"]
        )
        self.assertEqual([emote.name for emote in content.emotes], ["Kappa", "Wave"])

    def test_splits_unicode_emoji_into_image_part(self) -> None:
        resolver = MessageContentResolver(EmoteCatalog())
        smile = chr(0x1F600)

        content = resolver.resolve(QueuedMessage(username="viewer", text=f"hi {smile}"))

        self.assertEqual(content.text, "hi")
        self.assertEqual(content.parts[0].text, "hi ")
        self.assertEqual(content.parts[1].type, "image")
        self.assertEqual(content.emotes[0].name, smile)


class VisualEventFactoryTest(unittest.TestCase):
    def test_creates_chat_event_with_stable_identity(self) -> None:
        factory = VisualEventFactory(
            MessageContentResolver(EmoteCatalog()),
            UserVisualIdentity(),
        )

        event = factory.create(
            QueuedMessage(username="viewer", text="hello", avatar_url="avatar.png"),
        )

        self.assertEqual(event.event, "chat_message")
        self.assertEqual(event.username, "viewer")
        self.assertEqual(event.text, "hello")
        self.assertEqual(event.avatar_url, "avatar.png")
        self.assertRegex(event.color, r"^#[0-9a-f]{6}$")
        self.assertGreaterEqual(event.seed, 0)

    def test_creates_system_event_without_chat_content(self) -> None:
        factory = VisualEventFactory(
            MessageContentResolver(EmoteCatalog()),
            UserVisualIdentity(),
        )

        event = factory.create(
            QueuedMessage(
                username="raider",
                text="",
                kind=MessageKind.SYSTEM,
                system_event=EventType.RAID,
                system_data={"viewers": 42},
            ),
        )

        self.assertEqual(event.event, "raid")
        self.assertEqual(event.data, {"viewers": 42})
        self.assertEqual(event.text, "")


if __name__ == "__main__":
    unittest.main()


class EmoteCatalogFromFileTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.dir = Path(self._tmp.name)

    def _write(self, name: str, content: str) -> Path:
        path = self.dir / name
        path.write_text(content, encoding="utf-8")
        return path

    def test_loads_dict_format(self) -> None:
        path = self._write(
            "emotes.db",
            json.dumps({"Kappa": {"url_4x": "big.png"}}),
        )

        catalog = EmoteCatalog.from_file(str(path))
        emote = catalog.resolve("Kappa")

        self.assertIsNotNone(emote)
        assert emote is not None
        self.assertEqual(emote.url, "big.png")

    def test_loads_list_format(self) -> None:
        path = self._write(
            "emotes.db",
            json.dumps([{"name": "Wave", "url_2x": "wave.png"}, {"no_name": True}]),
        )

        catalog = EmoteCatalog.from_file(str(path))
        emote = catalog.resolve("Wave")

        self.assertIsNotNone(emote)
        assert emote is not None
        self.assertEqual(emote.url, "wave.png")

    def test_falls_back_to_all_emotes_json(self) -> None:
        self._write("all_emotes.json", json.dumps({"Party": "party.png"}))

        catalog = EmoteCatalog.from_file(str(self.dir / "emotes.db"))

        self.assertIsNotNone(catalog.resolve("Party"))

    def test_missing_file_yields_empty_catalog(self) -> None:
        catalog = EmoteCatalog.from_file(str(self.dir / "nope.db"))

        self.assertIsNone(catalog.resolve("Kappa"))

    def test_malformed_json_yields_empty_catalog(self) -> None:
        path = self._write("emotes.db", "{not json")

        catalog = EmoteCatalog.from_file(str(path))

        self.assertIsNone(catalog.resolve("Kappa"))

    def test_unexpected_top_level_type_yields_empty_catalog(self) -> None:
        path = self._write("emotes.db", json.dumps("just a string"))

        catalog = EmoteCatalog.from_file(str(path))

        self.assertIsNone(catalog.resolve("Kappa"))
