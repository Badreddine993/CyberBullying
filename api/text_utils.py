"""Text normalisation shared by the notebook (training) and the API (serving)."""
import re

_URL = re.compile(r"https?://\S+|www\.\S+")
_MENTION = re.compile(r"@\w+")
_HASHTAG = re.compile(r"#(\w+)")
_NON_ALPHA = re.compile(r"[^a-z0-9'\s!?]")
_REPEAT = re.compile(r"(.)\1{2,}")  # "soooo" -> "soo"
_SPACES = re.compile(r"\s+")


def clean_text(text: str) -> str:
    if not isinstance(text, str):
        return ""
    t = text.lower()
    t = _URL.sub(" url ", t)
    t = _MENTION.sub(" user ", t)
    t = _HASHTAG.sub(r" \1 ", t)
    t = _REPEAT.sub(r"\1\1", t)
    t = _NON_ALPHA.sub(" ", t)
    return _SPACES.sub(" ", t).strip()
