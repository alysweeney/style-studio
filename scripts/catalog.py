"""Turn closet photos and listing screenshots into tagged items.

Dry-run by default, per the repo convention. Nothing lands in closet.json
without --apply, and every batch is meant to be eyeballed first — vision
tagging gets fit, fabric, and formality wrong often enough to matter.

  python3 scripts/catalog.py                  # tag everything new, print, write nothing
  python3 scripts/catalog.py --apply          # tag and save
  python3 scripts/catalog.py --only tee-*.jpg # one batch
"""

import argparse
import sys
from pathlib import Path

import lib

ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "id": {"type": "string", "description": "kebab-case slug, e.g. tee-white-boxy-01"},
        "name": {"type": "string", "description": "how a person would refer to it out loud"},
        "category": {"enum": ["top", "bottom", "dress", "outerwear", "shoes", "bag", "accessory"]},
        "subcategory": {"type": "string"},
        "color_primary": {"type": "string"},
        "color_secondary": {"type": ["string", "null"]},
        "color_family": {"enum": ["neutral", "earth", "cool", "warm", "jewel", "pastel"]},
        "value": {"enum": ["light", "mid", "dark"]},
        "saturation": {"enum": ["muted", "medium", "saturated"]},
        "fabric": {"type": "string"},
        "texture": {"enum": ["smooth", "crisp", "ribbed", "nubby", "fuzzy", "slick", "drapey-soft"]},
        "pattern": {"enum": ["solid", "stripe", "check", "floral", "graphic", "print"]},
        "structure": {"type": "integer", "minimum": 1, "maximum": 5},
        "silhouette": {"enum": ["fitted", "straight", "relaxed", "oversized"]},
        "length": {"type": ["string", "null"]},
        "rise": {"enum": ["low", "mid", "high", "n/a"]},
        "leg": {"enum": ["skinny", "straight", "wide", "barrel", "flare", "n/a"]},
        "warmth": {"type": "integer", "minimum": 0, "maximum": 5},
        "formality": {"type": "integer", "minimum": 1, "maximum": 5},
        "seasons": {"type": "array", "items": {"enum": ["spring", "summer", "fall", "winter"]}},
        "water_ok": {"type": "boolean", "description": "survives rain without damage"},
        "uncertain_fields": {
            "type": "array",
            "items": {"type": "string"},
            "description": "fields you genuinely could not determine from the photo",
        },
        "notes": {"type": "string"},
    },
    "required": [
        "id", "name", "category", "subcategory", "color_primary", "color_secondary",
        "color_family", "value", "saturation", "fabric", "texture", "pattern",
        "structure", "silhouette", "length", "rise", "leg", "warmth", "formality",
        "seasons", "water_ok", "uncertain_fields", "notes",
    ],
    "additionalProperties": False,
}

SYSTEM = """You tag garments for a personal closet catalog. Below is the project's
taxonomy — the field definitions are binding, especially the warmth scale.

%s

Rules:
- Judge only what the photo actually shows. If the fabric is ambiguous, say so in
  `uncertain_fields` rather than picking the likely answer. A field flagged uncertain
  gets reviewed by a person; a confidently wrong field does not.
- `fit_status` and `comfort` are deliberately NOT yours to set. A photo cannot show
  whether something fits or whether she'll keep it on all day. They're added by hand.
- Warmth is the weather engine's only input, so weigh it carefully: it's about
  insulation, not season vibes. A thin linen long-sleeve is warmth 1, not 3.
- `rise` and `leg` are "n/a" for anything that isn't a bottom.
- For a listing screenshot rather than a worn photo, tag the garment, not the styling
  around it.""" % lib.taxonomy_text()


def tag_photo(client, path: Path) -> dict:
    resp = client.messages.create(
        model=lib.MODEL,
        max_tokens=4000,
        system=SYSTEM,
        output_config={"format": {"type": "json_schema", "schema": ITEM_SCHEMA}},
        messages=[{
            "role": "user",
            "content": [
                lib.image_block(path),
                {"type": "text", "text": f"Tag this garment. Source file: {path.name}"},
            ],
        }],
    )
    if resp.stop_reason == "refusal":
        raise SystemExit(f"Refused on {path.name}: {resp.stop_details}")
    text = next(b.text for b in resp.content if b.type == "text")
    import json
    return json.loads(text)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write to closet.json")
    ap.add_argument("--only", default="*", help="glob within photos/closet/")
    args = ap.parse_args()

    photo_dir = lib.PHOTOS / "closet"
    photos = sorted(p for p in photo_dir.glob(args.only)
                    if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".heic"})
    if not photos:
        raise SystemExit(f"No photos in {photo_dir}. Drop closet photos or listing "
                         f"screenshots there and run again.")

    closet = lib.load_closet()
    already = {i.get("source_photo") for i in closet["items"]}
    todo = [p for p in photos if p.name not in already]
    print(f"{len(photos)} photos, {len(todo)} untagged\n", file=sys.stderr)

    client = lib.client()
    tagged = []
    for path in todo:
        item = tag_photo(client, path)
        item["source_photo"] = path.name
        item["fit_status"] = None      # set by hand
        item["comfort"] = None         # set by hand
        item["wear_count"] = 0
        item["last_worn"] = None
        tagged.append(item)

        flag = f"  ⚠ uncertain: {', '.join(item['uncertain_fields'])}" if item["uncertain_fields"] else ""
        print(f"{item['name']:<38} {item['category']:<10} warmth {item['warmth']}  "
              f"formality {item['formality']}{flag}")

    if not args.apply:
        print(f"\nDry run — nothing written. Review the list, then re-run with --apply.",
              file=sys.stderr)
        return

    closet["items"].extend(tagged)
    lib.write_json(lib.CLOSET, closet)
    print(f"\nWrote {len(tagged)} items to {lib.CLOSET}", file=sys.stderr)
    print("Now set fit_status and comfort by hand — the engine skips items missing them.",
          file=sys.stderr)


if __name__ == "__main__":
    main()
