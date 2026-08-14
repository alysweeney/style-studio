"""The morning job: compose the day's outfits on the Mac, leave them in Firestore.

The phone can do the weather and the rules on its own. What it can't do is call
Claude — an Anthropic key is a bearer credential and would be readable by anyone
who viewed source. So the thinking happens here and the phone reads the result.

The split, again, because it's the whole design:
  rules  — anything with a right answer (warmth, fit, laundry, formality)
  Claude — the part with none (which combination reads like her boards, and why)

Dry run by default, per repo convention. It prints what it would write and
touches nothing until --apply.

  python3 scripts/morning.py                 # dry run
  python3 scripts/morning.py --apply         # write today's outfits
  python3 scripts/morning.py --formality 4   # dressing up
"""

import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import firestore
import lib
import outfit
import weather

CONFIG = lib.CONFIG_DIR / "style-studio.env"

# The morning job never needs the pixels — just the tags. Each closet document
# carries a ~40 KB thumbnail, so asking for everything would pull well over a
# megabyte to make one decision.
TAG_FIELDS = [
    "id", "name", "category", "subcategory", "color_primary", "color_family",
    "value", "saturation", "texture", "pattern", "structure", "silhouette",
    "length", "rise", "leg", "warmth", "formality_range", "seasons", "water_ok",
    "fits_now", "comfort", "wear_count", "last_worn", "notes",
]


def credentials():
    lib.load_env()
    if CONFIG.exists():
        for line in CONFIG.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

    email = os.environ.get("STYLE_STUDIO_EMAIL")
    password = os.environ.get("STYLE_STUDIO_PASSWORD")
    if not email or not password:
        raise SystemExit(
            f"Missing sign-in details.\nCreate {CONFIG} containing:\n"
            f"  STYLE_STUDIO_EMAIL=you@example.com\n"
            f"  STYLE_STUDIO_PASSWORD=...\n"
            f"  ANTHROPIC_API_KEY=sk-ant-...\n"
            f"Then: chmod 600 {CONFIG}\n"
            f"(Same address and password you sign into the app with. The file sits\n"
            f" outside the repo on purpose — the repo is public.)"
        )
    return email, password


def compose(client, candidates, forecast, season, formality, dna):
    """Ask Claude for the outfits the rules have already made possible."""
    strip = ["id", "name", "category", "subcategory", "color_primary", "color_family",
             "value", "texture", "pattern", "structure", "silhouette", "length",
             "rise", "leg", "warmth", "formality_range", "water_ok"]
    slim = [{k: c.get(k) for k in strip} for c in candidates]

    system = f"""You are styling one specific person from her own closet.

Her style DNA, distilled from her Pinterest boards:

{dna}

The taxonomy defining every field you'll see:

{lib.taxonomy_text()}

Compose 2-3 outfits from the candidate items only. Rules:

- Use item ids exactly as given. Never invent an item she doesn't own.
- Total warmth must land inside the target band. This is arithmetic, not vibes.
- `why_it_works` must name a specific proportion rule or texture pairing from her
  style DNA. "It's cute" is a failed answer; "this is the slim-top/wide-bottom
  formula from your boards, with the rib against smooth denim" is the job.
- At most one outfit may be a `stretch`. The rest should be things she'd
  plausibly put on tomorrow. An all-stretch list gets ignored and teaches nothing.
- If the closet genuinely can't support a good outfit today, say so plainly in
  `note` and return fewer outfits. Do not pad the list."""

    resp = client.messages.create(
        model=lib.MODEL,
        max_tokens=8000,
        system=system,
        output_config={"format": {"type": "json_schema", "schema": outfit.OUTFIT_SCHEMA}},
        messages=[{"role": "user", "content": json.dumps({
            "weather": forecast, "season": season,
            "target_formality": formality, "candidates": slim,
        })}],
    )
    if resp.stop_reason == "refusal":
        raise SystemExit(f"Refused: {resp.stop_details}")
    return json.loads(next(b.text for b in resp.content if b.type == "text"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write to Firestore")
    ap.add_argument("--formality", type=int, default=2, help="1 lounge … 5 formal")
    ap.add_argument("--lat", type=float, default=weather.DEFAULT_LAT)
    ap.add_argument("--lon", type=float, default=weather.DEFAULT_LON)
    args = ap.parse_args()

    email, password = credentials()
    db = firestore.Client(email, password)
    print(f"signed in as {email}", file=sys.stderr)

    closet = db.collection("closet", fields=TAG_FIELDS)
    if not closet:
        raise SystemExit("Closet is empty in Firestore. Import the seed from the app first.")

    log = db.collection("wearLog")
    forecast = weather.describe(weather.fetch(args.lat, args.lon))
    season = outfit.season_now()
    recent = outfit.recently_worn({"entries": log})

    candidates = [i for i in closet
                  if outfit.wearable(i, season, args.formality, recent)]

    print(f"\n{forecast['date']}  {forecast['high_f']:.0f}°/{forecast['low_f']:.0f}°F  "
          f"{forecast['conditions']}", file=sys.stderr)
    print(f"warmth target {forecast['warmth_target'][0]}–{forecast['warmth_target'][1]}  ·  "
          f"{len(candidates)}/{len(closet)} items in play at formality {args.formality}",
          file=sys.stderr)
    for m in forecast["modifiers"]:
        print(f"  · {m}", file=sys.stderr)

    if len(candidates) < 3:
        unrated = sum(1 for i in closet if i.get("fits_now") is None or not i.get("comfort"))
        raise SystemExit(
            f"\nOnly {len(candidates)} wearable items after filtering"
            + (f" — {unrated} still have no fit/comfort rating." if unrated else ".")
        )

    if not lib.STYLE_DNA.exists():
        raise SystemExit(f"No style DNA at {lib.STYLE_DNA}.")

    result = compose(lib.client(), candidates, forecast, season,
                     args.formality, lib.STYLE_DNA.read_text())

    by_id = {i["id"]: i for i in closet}
    for o in result["outfits"]:
        tag = "  [stretch]" if o["stretch"] else ""
        print(f"\n{o['name']}{tag}  ·  warmth {o['total_warmth']}")
        for iid in o["item_ids"]:
            print(f"   · {by_id.get(iid, {}).get('name', iid + ' (UNKNOWN ID)')}")
        print(f"   why: {o['why_it_works']}")
        print(f"   how: {o['styling_notes']}")
    if result.get("note"):
        print(f"\n{result['note']}")

    # Anything referencing an item she doesn't own is a bug, not a suggestion.
    unknown = [iid for o in result["outfits"] for iid in o["item_ids"] if iid not in by_id]
    if unknown:
        raise SystemExit(f"\nRefusing to write — invented item ids: {', '.join(unknown)}")

    if not args.apply:
        print("\nDry run — nothing written. Re-run with --apply.", file=sys.stderr)
        return

    today = dt.date.today().isoformat()
    db.put(f"outfits/{today}", {
        **result,
        "date": today,
        "formality": args.formality,
        "weather": {k: forecast[k] for k in ("high_f", "low_f", "conditions", "precip_pct")},
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
    })
    print(f"\nWrote users/{db.uid}/outfits/{today}", file=sys.stderr)


if __name__ == "__main__":
    main()
