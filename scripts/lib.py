"""Shared helpers: paths, config, Claude client, closet I/O."""

import base64
import json
import mimetypes
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
PHOTOS = ROOT / "photos"
CLOSET = DATA / "closet.json"
STYLE_DNA = DATA / "style-dna.md"
PREFS = DATA / "preferences.json"
WEAR_LOG = DATA / "wear-log.json"

CONFIG_DIR = Path.home() / ".config" / "personal-automation"
ENV_FILE = CONFIG_DIR / "anthropic.env"

MODEL = "claude-opus-5"


def load_env():
    """Read secrets from ~/.config/personal-automation/anthropic.env, never from the repo."""
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def client():
    """An Anthropic client, or a clear error explaining where the key belongs."""
    load_env()
    import anthropic

    if not os.environ.get("ANTHROPIC_API_KEY") and not os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        raise SystemExit(
            f"No API key found.\n"
            f"Put it in {ENV_FILE} as:\n"
            f"  ANTHROPIC_API_KEY=sk-ant-...\n"
            f"(That path is outside the repo on purpose — see the project README.)"
        )
    return anthropic.Anthropic()


def image_block(path: Path) -> dict:
    """A base64 image content block for the Messages API."""
    media_type = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    data = base64.standard_b64encode(path.read_bytes()).decode()
    return {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}}


def read_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text())


def write_json(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")


def load_closet():
    return read_json(CLOSET, {"items": []})


def taxonomy_text() -> str:
    """The taxonomy doc is the prompt. One source of truth, not two."""
    return (ROOT / "taxonomy.md").read_text()
