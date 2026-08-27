"""Twitch emote CDN URL helpers shared by the bot and handler modules.

Twitch serves emote images from a single CDN URL template with a
static/animated variant segment.  Keeping the template and the
static<->animated rewrites here means a CDN format change is a one-file edit.
"""

_CDN_TEMPLATE = (
    "https://static-cdn.jtvnw.net/emoticons/v2/{emote_id}/{variant}/dark/3.0"
)


def twitch_emote_cdn_url(emote_id: str, *, animated: bool = False) -> str:
    """Build a Twitch CDN emote URL for the given emote ID."""
    variant = "animated" if animated else "static"
    return _CDN_TEMPLATE.format(emote_id=emote_id, variant=variant)


def plain_twitch_emote_url(url: str) -> str:
    """Prefer static Twitch emotes so clients do not retry animated fallbacks."""
    return url.replace("/animated/", "/static/").replace("/default/", "/static/")


def animated_twitch_emote_url(url: str) -> str:
    """Build the matching animated Twitch CDN URL when possible."""
    return url.replace("/static/", "/animated/").replace("/default/", "/animated/")
