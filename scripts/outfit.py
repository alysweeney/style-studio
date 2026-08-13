"""The hybrid engine: rules narrow the closet, Claude composes the outfits.

The split matters. Rules handle everything with a right answer — warmth math,
what's in the laundry, what she wore yesterday, what doesn't fit. Claude handles
the part with no right answer: which combination actually looks like her Pinterest
boards, and why. Asking a model to do arithmetic about layers is how you get
outfits that are wrong about the weather.

  python3 scripts/outfit.py                       # today, casual
  python3 scripts/outfit.py --formality 4         # dinner
  python3 scripts/outfit.py --dry-run             # show candidates, skip the API call
"""

import argparse
import datetime as dt
import json
import sys

import lib
import weather

OUTFIT_SCHEMA = {
    "type": "object",
    "properties": {
        "outfits": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "short evocative label"},
                    "item_ids": {"type": "array", "items": {"type": "string"}},
                    "total_warmth": {"type": "integer"},
                    "why_it_works": {
                        "type": "string",
                        "description": "tie it to a specific proportion rule or texture "
                                       "pairing from her style DNA, by name",
                    },
                    "styling_notes": {
                        "type": "string",
                        "description": "the moves that make it: tuck, cuff, sleeve, layer order",
                    },
                    "stretch": {
                        "type": "boolean",
                        "description": "true if this pushes past what she normally wears",
                    },
                },
                "required": ["name", "item_ids", "total_warmth", "why_it_works",
                             "styling_notes", "stretch"],
                "additionalProperties": False,
            },
        },
        "note": {
            "type": "string",
            "description": "one honest sentence if the closet couldn't support a good "
                           "option today; empty string otherwise",
        },
    },
    "required": ["outfits", "note"],
    "additionalProperties": False,
}


def wearable(item, season, formality, recent_ids):
    """The deterministic filter. Everything here has a right answer."""
    if item.get("condition") == "retire":
        return False
    # Per CHECKS.md: never surface something that doesn't fit or isn't comfortable.
    if item.get("fit_status") == "poor" or item.get("comfort") == 1:
        return False
    # Not yet reviewed by a human — don't guess.
    if item.get("fit_status") is None:
        return False
    if season not in item.get("seasons", []):
        return False
    # Formality is a range, not a point. A plain white tee genuinely works at
    # casual AND at polished; a striped pocket tee does not. Using a single
    # number with a fixed tolerance got this wrong in both directions — it
    # refused white-tee-with-tailored-trousers (2 vs 4, the best outfit in the
    # catalog) while happily pairing a baseball raglan with suiting.
    lo, hi = item.get("formality_range") or ([item.get("formality", 3)] * 2)
    if not lo <= formality <= hi:
        return False
    if item["id"] in recent_ids:
        return False
    return True


def recently_worn(log, days=3):
    cutoff = dt.date.today() - dt.timedelta(days=days)
    ids = set()
    for entry in log.get("entries", []):
        if dt.date.fromisoformat(entry["date"]) >= cutoff:
            ids.update(entry.get("item_ids", []))
    return ids


def season_now():
    m = dt.date.today().month
    return {12: "winter", 1: "winter", 2: "winter", 3: "spring", 4: "spring",
            5: "spring", 6: "summer", 7: "summer", 8: "summer", 9: "fall",
            10: "fall", 11: "fall"}[m]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--formality", type=int, default=2, help="1 lounge … 5 formal")
    ap.add_argument("--dry-run", action="store_true", help="show candidates, no API call")
    ap.add_argument("--lat", type=float, default=weather.DEFAULT_LAT)
    ap.add_argument("--lon", type=float, default=weather.DEFAULT_LON)
    args = ap.parse_args()

    closet = lib.load_closet()
    if not closet["items"]:
        raise SystemExit("Closet is empty. Run scripts/catalog.py first.")

    if not lib.STYLE_DNA.exists():
        raise SystemExit(f"No style DNA at {lib.STYLE_DNA}. Without it this is just a "
                         f"weather-appropriate random outfit generator — which is not "
                         f"the point. Capture the Pinterest boards first.")

    forecast = weather.describe(weather.fetch(args.lat, args.lon))
    season = season_now()
    recent = recently_worn(lib.read_json(lib.WEAR_LOG, {"entries": []}))

    candidates = [i for i in closet["items"]
                  if wearable(i, season, args.formality, recent)]

    print(f"{forecast['date']}  {forecast['high_f']:.0f}°/{forecast['low_f']:.0f}°F  "
          f"{forecast['conditions']}", file=sys.stderr)
    print(f"warmth target {forecast['warmth_target'][0]}–{forecast['warmth_target'][1]}  ·  "
          f"{len(candidates)}/{len(closet['items'])} items in play", file=sys.stderr)
    for m in forecast["modifiers"]:
        print(f"  · {m}", file=sys.stderr)

    if args.dry_run:
        for i in candidates:
            print(f"  {i['id']:<28} {i['category']:<10} warmth {i['warmth']}")
        return

    if len(candidates) < 3:
        raise SystemExit("\nFewer than 3 wearable items after filtering. Either the "
                         "catalog is too thin or the filters are too tight — check "
                         "fit_status is set on your items.")

    strip = ["id", "name", "category", "subcategory", "color_primary", "color_family",
             "value", "texture", "pattern", "structure", "silhouette", "length",
             "rise", "leg", "warmth", "formality", "water_ok"]
    slim = [{k: i.get(k) for k in strip} for i in candidates]

    system = f"""You are styling one specific person from her own closet.

Her style DNA, distilled from her Pinterest boards:

{lib.STYLE_DNA.read_text()}

The taxonomy defining every field you'll see:

{lib.taxonomy_text()}

Compose 2–3 outfits from the candidate items only. Rules:

- Use item ids exactly as given. Never invent an item she doesn't own.
- Total warmth must land inside the target band. This is arithmetic, not vibes.
- `why_it_works` must name a specific proportion rule or texture pairing from her
  style DNA. "It's cute" is a failed answer; "this is the volume-on-top/slim-bottom
  formula from your boards, with the ribbed knit against smooth denim" is the job.
- Make at most one outfit a `stretch`. The rest should be things she'd plausibly
  put on tomorrow. An all-stretch list gets ignored and teaches her nothing.
- If the closet genuinely can't support a good outfit today, say so plainly in
  `note` and return fewer outfits. Do not pad the list."""

    user = {
        "weather": forecast,
        "season": season,
        "target_formality": args.formality,
        "candidates": slim,
    }

    resp = lib.client().messages.create(
        model=lib.MODEL,
        max_tokens=8000,
        system=system,
        output_config={"format": {"type": "json_schema", "schema": OUTFIT_SCHEMA}},
        messages=[{"role": "user", "content": json.dumps(user)}],
    )
    if resp.stop_reason == "refusal":
        raise SystemExit(f"Refused: {resp.stop_details}")

    result = json.loads(next(b.text for b in resp.content if b.type == "text"))
    by_id = {i["id"]: i for i in closet["items"]}

    for o in result["outfits"]:
        tag = "  [stretch]" if o["stretch"] else ""
        print(f"\n{o['name']}{tag}  ·  warmth {o['total_warmth']}")
        for iid in o["item_ids"]:
            print(f"   · {by_id.get(iid, {}).get('name', iid)}")
        print(f"   why: {o['why_it_works']}")
        print(f"   how: {o['styling_notes']}")
    if result["note"]:
        print(f"\n{result['note']}")


if __name__ == "__main__":
    main()
