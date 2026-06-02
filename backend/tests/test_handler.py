import unittest

from vizer.handler import (
    EmoteCatalog,
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
        self.assertEqual(emote.name, "Kappa")
        self.assertEqual(emote.url, "big.png")

    def test_uses_message_url_when_cache_misses(self) -> None:
        catalog = EmoteCatalog()

        emote = catalog.resolve("Party", "party.png")

        self.assertIsNotNone(emote)
        self.assertEqual(emote.url, "party.png")


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
        self.assertEqual([part.type for part in content.parts], ["text", "image", "image"])
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
                system_event="raid",
                system_data={"viewers": 42},
            ),
        )

        self.assertEqual(event.event, "raid")
        self.assertEqual(event.data, {"viewers": 42})
        self.assertEqual(event.text, "")


if __name__ == "__main__":
    unittest.main()
