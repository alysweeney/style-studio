"""Build a seed file for the app's bulk import.

Loading a wardrobe one garment at a time, answering a form each time, is the
fastest way to never finish. This tags the whole closet in one pass and emits a
single JSON the app imports in one go.

The tags below were read off the photos rather than inferred by the app: a
browser can measure colour and lightness, but it can't tell a henley from a
crewneck. Fields the photos genuinely can't answer — whether something fits her
body right now, and how comfortable it is — are left for the import screen,
where she sets a default once and flags the exceptions.

  python3 scripts/seed.py            # dry run, prints what it found
  python3 scripts/seed.py --apply    # writes data/seed.json
"""

import argparse
import base64
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import lib

# Source folders, in priority order. HEIC is handled the same as anything else
# because sips does the decoding before Python ever sees the pixels.
SOURCES = [Path.home() / "Desktop" / "closet", lib.PHOTOS / "closet"]

THUMB_PX = 420
JPEG_QUALITY = 72


def T(**kw):
    """An item with the defaults most garments share, overridden as needed."""
    base = dict(
        category="top", subcategory="", color_secondary=None, color_family="neutral",
        value="mid", saturation="muted", fabric="cotton jersey", texture="smooth",
        pattern="solid", structure=2, silhouette="relaxed", length="hip",
        rise="n/a", leg="n/a", warmth=2, formality_range=[2, 3],
        seasons=["spring", "fall", "winter"], water_ok=False, uncertain_fields=[],
        rotate=0, notes="",
    )
    base.update(kw)
    return base


ALL_SEASONS = ["spring", "summer", "fall", "winter"]
WARM = ["spring", "summer", "fall"]

# ---------------------------------------------------------------- the catalog
CATALOG = {
    # ---- tops
    "IMG_6025": T(id="tee-portland-navy", name="faded navy Portland tee",
                  subcategory="graphic tee", color_primary="faded navy", color_family="cool",
                  value="mid", pattern="graphic", silhouette="relaxed", length="hip",
                  warmth=1, formality_range=[2, 2], seasons=ALL_SEASONS,
                  notes="The only graphic tee in the closet, and graphics are near-absent "
                        "from her boards — expect this to score low and that's correct."),
    "IMG_6027": T(id="top-henley-black-ribbed", name="black ribbed henley",
                  subcategory="long sleeve henley", color_primary="black",
                  value="dark", texture="ribbed", silhouette="fitted",
                  formality_range=[2, 3],
                  notes="Fitted rib — a good slim top for the volume-bottom formula."),
    "IMG_6028": T(id="shirt-stripe-blue-oversized", name="blue striped oversized shirt",
                  subcategory="button-down", color_primary="light blue",
                  color_secondary="white", color_family="cool", value="light",
                  fabric="cotton poplin", texture="crisp", pattern="stripe",
                  structure=3, silhouette="oversized", length="long",
                  formality_range=[2, 4], seasons=ALL_SEASONS,
                  notes="Gap oversized poplin with contrast white collar and cuffs. This is "
                        "gap item #2 from the style DNA — the crisp button-down. Reaches to "
                        "polished, and doubles as a light layer."),
    "IMG_6029": T(id="top-ruched-black", name="black ruched-front top",
                  subcategory="long sleeve top", color_primary="black", value="dark",
                  fabric="stretch jersey", texture="slick", silhouette="fitted",
                  formality_range=[3, 4],
                  notes="Slinky and body-skimming; the dressiest top in the closet."),
    "IMG_6030": T(id="top-henley-stripe-bw", name="black and white striped henley",
                  subcategory="long sleeve henley", color_primary="black",
                  color_secondary="white", value="mid", texture="ribbed",
                  pattern="stripe", silhouette="fitted", formality_range=[2, 3],
                  notes="High value contrast built into one piece — stripes are one of only "
                        "two patterns with real presence in her pins."),
    "IMG_6031": T(id="top-longsleeve-white-ribbed", name="white ribbed long sleeve",
                  subcategory="long sleeve tee", color_primary="white", value="light",
                  texture="ribbed", silhouette="fitted", formality_range=[2, 4],
                  seasons=ALL_SEASONS,
                  notes="Formality-elastic the same way the white cropped tee is: plain, "
                        "fitted, light. Works under tailoring and with jeans."),
    "IMG_6039": T(id="top-tube-black-ribbed", name="black ribbed tube top",
                  subcategory="strapless top", color_primary="black", value="dark",
                  texture="ribbed", silhouette="fitted", length="cropped",
                  warmth=1, formality_range=[2, 4], seasons=WARM,
                  uncertain_fields=["subcategory", "length"],
                  notes="Flagged uncertain: laid flat this could equally be a ribbed knit "
                        "skirt. Worth confirming before it starts appearing as a top."),
    "IMG_6041": T(id="top-cami-olive-knit", name="olive knit cami",
                  subcategory="cami", color_primary="olive", color_family="earth",
                  value="mid", fabric="loose knit", texture="nubby", silhouette="relaxed",
                  warmth=1, formality_range=[2, 3], seasons=WARM,
                  notes="Olive is one of her recurring accents, and the open knit is a "
                        "texture she has almost nothing else of."),
    "IMG_6046": T(id="tee-teal-relaxed", name="teal short sleeve tee",
                  subcategory="tee", color_primary="teal", color_family="cool",
                  value="mid", silhouette="relaxed", warmth=1,
                  formality_range=[2, 2], seasons=ALL_SEASONS,
                  notes="Teal sits outside the board palette — expect it to score lower "
                        "than the neutrals, which is honest rather than a bug."),
    "IMG_6047": T(id="top-cami-ivory-lace", name="ivory lace-trim camisole",
                  subcategory="cami", color_primary="ivory", value="light",
                  fabric="satin and lace", texture="slick", silhouette="straight",
                  warmth=1, formality_range=[1, 3], seasons=WARM,
                  notes="Reads as lingerie flat, but under the leather jacket or a cardigan "
                        "it's the layering piece her boards use constantly."),
    "IMG_6049": T(id="sweat-black-crew", name="black crewneck sweatshirt",
                  subcategory="sweatshirt", color_primary="black", value="dark",
                  fabric="fleece-back cotton", texture="smooth", structure=1,
                  silhouette="oversized", warmth=3, formality_range=[1, 2],
                  notes="The soft mode, squarely. Not a flaw — half her boards are this."),
    "11.00.40": T(id="top-eyelet-white", name="white eyelet tank",
                subcategory="tank", color_primary="white", value="light",
                fabric="cotton eyelet", texture="crisp", pattern="floral",
                silhouette="relaxed", length="cropped", warmth=0,
                formality_range=[2, 3], seasons=["spring", "summer"],
                notes="Listing shot on a model — replace with a flat product photo when "
                      "you can, or the cutout will keep a torso."),

    # ---- bottoms
    "IMG_6026": T(id="shorts-black-lace-sleep", name="black lace sleep shorts",
                  category="bottom", subcategory="shorts", color_primary="black",
                  value="dark", fabric="satin and lace", texture="slick",
                  silhouette="relaxed", length="mini", rise="mid", leg="wide",
                  warmth=0, formality_range=[1, 1], seasons=ALL_SEASONS,
                  notes="Formality 1 only. Never leaves the house, and the engine "
                        "will never suggest it outside lounge."),
    "IMG_6044": T(id="skort-denim-mid", name="mid-wash denim skort",
                  category="bottom", subcategory="skort", rotate=180, color_primary="mid blue",
                  color_family="cool", fabric="denim", texture="crisp", structure=3,
                  silhouette="straight", length="mini", rise="high", leg="n/a",
                  formality_range=[2, 3], seasons=WARM,
                  uncertain_fields=["subcategory"],
                  notes="Corrected by Aly 2026-08-14: a skort, not a skirt, and the "
                        "photo is upside down — hence rotate=180. Possibly the same "
                        "garment as IMG_6045 from another angle; check before both end "
                        "up in the closet as separates."),
    "IMG_6045": T(id="skirt-denim-utility", name="denim utility skirt",
                  category="bottom", subcategory="skirt", color_primary="mid blue",
                  color_family="cool", fabric="denim", texture="crisp", structure=3,
                  silhouette="straight", length="knee", rise="high", leg="n/a",
                  formality_range=[2, 3], seasons=WARM,
                  uncertain_fields=["subcategory"],
                  notes="Patch pockets and a button placket. See the note on IMG_6044 — "
                        "these two may be one skirt."),
    "IMG_6048": T(id="sweats-gyoza-white", name="gyoza print sweatpants",
                  category="bottom", subcategory="joggers", color_primary="white",
                  value="light", fabric="fleece-back cotton", texture="smooth",
                  pattern="print", structure=1, silhouette="relaxed", length="full",
                  rise="mid", leg="straight", warmth=3, formality_range=[1, 1],
                  notes="Lounge only, and delightfully so."),
    "10.58.02": T(id="jeans-wide-tie-mid", name="mid-wash tie-waist wide jeans",
                category="bottom", subcategory="jeans", color_primary="mid blue",
                color_family="cool", fabric="denim", texture="crisp", structure=3,
                silhouette="relaxed", length="full", rise="high", leg="wide",
                formality_range=[2, 3], seasons=ALL_SEASONS,
                notes="A mid-wash wide leg — this is close to the exact jean the gap list "
                      "kept asking for. Listing shot on a model; swap for a flat one."),
    "10.59.35": T(id="shorts-eyelet-white", name="white eyelet ruffle shorts",
                category="bottom", subcategory="shorts", color_primary="white",
                value="light", fabric="cotton eyelet", texture="crisp", pattern="floral",
                silhouette="relaxed", length="mini", rise="mid", leg="wide",
                warmth=0, formality_range=[2, 3], seasons=["spring", "summer"],
                notes="Pairs with the eyelet tank as a set. Listing shot on a model."),

    # ---- outerwear
    "IMG_6038": T(id="cardigan-grey-mohair", name="grey mohair cardigan",
                  category="outerwear", subcategory="cardigan", color_primary="grey",
                  value="light", fabric="mohair blend", texture="fuzzy", structure=1,
                  silhouette="oversized", warmth=3, formality_range=[2, 3],
                  seasons=["fall", "winter"],
                  notes="The only fuzzy texture in the closet — genuinely useful against "
                        "all the smooth jersey."),
    "IMG_6040": T(id="cardigan-grey-wrap", name="grey ribbed wrap cardigan",
                  category="outerwear", subcategory="cardigan", color_primary="grey",
                  value="light", fabric="ribbed knit", texture="ribbed", structure=2,
                  silhouette="relaxed", warmth=3, formality_range=[2, 4],
                  seasons=["fall", "winter", "spring"],
                  notes="Ties at the waist, so it holds a shape rather than hanging open. "
                        "Reaches to polished."),
    "IMG_6042": T(id="jacket-leather-black", name="black leather jacket",
                  category="outerwear", subcategory="jacket", color_primary="black",
                  value="dark", fabric="leather", texture="slick", structure=4,
                  silhouette="relaxed", warmth=3, formality_range=[2, 4],
                  seasons=["spring", "fall", "winter"], water_ok=True,
                  notes="The most structured piece she owns and the only water-ok layer. "
                        "Expect it to win most rainy days by default."),

    # ---- shoes
    "IMG_6032": T(id="flats-ballet-blush", name="blush ballet flats",
                  category="shoes", subcategory="flats", color_primary="blush",
                  color_family="pastel", value="light", fabric="leather",
                  texture="smooth", structure=2, silhouette="fitted", length=None,
                  warmth=1, formality_range=[2, 4], seasons=WARM,
                  notes="Gap item #4 from the style DNA — ballet flats are one of only "
                        "three shoe modes in her entire board set."),
    "IMG_6033": T(id="sneakers-blazer-mid", name="white Nike Blazer mid",
                  category="shoes", subcategory="sneakers", color_primary="white",
                  value="light", fabric="leather", texture="smooth", structure=3,
                  silhouette="relaxed", length=None, warmth=2, formality_range=[2, 2],
                  seasons=ALL_SEASONS,
                  notes="White sneakers are the third shoe mode in her pins."),
    "IMG_6034": T(id="sneakers-blazer-low", name="white Nike Blazer low",
                  category="shoes", subcategory="sneakers", color_primary="white",
                  value="light", fabric="leather", texture="smooth", structure=3,
                  silhouette="relaxed", length=None, warmth=2, formality_range=[2, 2],
                  seasons=ALL_SEASONS,
                  notes="Visibly the more worn of the two pairs."),
    "IMG_6035": T(id="heels-slingback-cream", name="cream patent slingbacks",
                  category="shoes", subcategory="heels", color_primary="cream",
                  value="light", fabric="patent leather", texture="slick", structure=3,
                  silhouette="fitted", length=None, warmth=1, formality_range=[3, 5],
                  seasons=WARM,
                  notes="Kitten heel. Reaches formality 5, so it's the only thing that "
                        "makes a genuinely formal outfit possible."),
    "IMG_6036": T(id="boots-ankle-black-suede", name="black suede ankle boots",
                  category="shoes", subcategory="boots", color_primary="black",
                  value="dark", fabric="suede", texture="nubby", structure=3,
                  silhouette="fitted", length=None, warmth=3, formality_range=[2, 4],
                  seasons=["fall", "winter"],
                  notes="Suede, so the rain rule will correctly keep these in on wet days."),
    "IMG_6037": T(id="heels-slingback-black", name="black patent slingbacks",
                  category="shoes", subcategory="heels", color_primary="black",
                  value="dark", fabric="patent leather", texture="slick", structure=3,
                  silhouette="fitted", length=None, warmth=1, formality_range=[3, 5],
                  seasons=ALL_SEASONS,
                  notes="Pointed toe, stiletto. The other half of the formal option."),

    # ---- accessories
    "IMG_6043": T(id="scarf-silk-print", name="printed silk scarf",
                  category="accessory", subcategory="scarf", color_primary="blue",
                  color_secondary="orange", color_family="jewel", value="mid",
                  saturation="saturated", fabric="silk", texture="slick",
                  pattern="print", structure=1, silhouette="straight", length=None,
                  warmth=0, formality_range=[2, 4], seasons=ALL_SEASONS,
                  notes="The single most saturated thing she owns. Her boards are almost "
                        "entirely muted, so this is the one deliberate colour moment."),
}


LIFT = Path(__file__).resolve().parent.parent / "tools" / "liftsubject"
CWEBP = shutil.which("cwebp")   # brew install webp


def to_thumb(src: Path):
    """A garment thumbnail, background removed where possible.

    Prefers `tools/liftsubject`, which uses Apple's own subject-segmentation
    model — the one Photos uses for long-press subject lift. It solves the cases
    a colour flood fill fundamentally cannot: a white top on a white sheet, a
    pale camisole on pale bedding, a garment that shares its colour with the
    surface under it. It also crops to the subject, so every piece arrives at a
    consistent scale instead of floating in whatever margin the photo had.

    Falls back to a plain sips resize when the binary isn't built or Vision
    finds no subject; the app's own flood fill then has a go at it.
    """
    if LIFT.exists():
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            cut = Path(tmp.name)
        done = subprocess.run([str(LIFT), str(src), str(cut)], capture_output=True)
        if done.returncode == 0 and cut.stat().st_size > 0:
            # A cut-out needs an alpha channel, and PNG pays dearly for it —
            # roughly 200 KB a garment, which is 8 MB across a wardrobe and a
            # slow first load on a phone. WebP carries the same alpha at about
            # a tenth the size. sips can read WebP but not write it, hence cwebp.
            if CWEBP:
                webp = cut.with_suffix(".webp")
                enc = subprocess.run(
                    [CWEBP, "-quiet", "-q", "82", "-alpha_q", "90",
                     "-resize", str(THUMB_PX), "0", str(cut), "-o", str(webp)],
                    capture_output=True,
                )
                if enc.returncode == 0 and webp.exists() and webp.stat().st_size > 0:
                    data = base64.b64encode(webp.read_bytes()).decode()
                    cut.unlink(missing_ok=True); webp.unlink(missing_ok=True)
                    return "data:image/webp;base64," + data, True
                webp.unlink(missing_ok=True)

            subprocess.run(
                ["sips", "-Z", str(THUMB_PX), "--setProperty", "format", "png",
                 str(cut), "--out", str(cut)],
                check=True, capture_output=True,
            )
            data = base64.b64encode(cut.read_bytes()).decode()
            cut.unlink(missing_ok=True)
            return "data:image/png;base64," + data, True
        cut.unlink(missing_ok=True)

    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        out = Path(tmp.name)
    subprocess.run(
        ["sips", "-Z", str(THUMB_PX), "--setProperty", "format", "jpeg",
         "--setProperty", "formatOptions", str(JPEG_QUALITY), str(src), "--out", str(out)],
        check=True, capture_output=True,
    )
    data = base64.b64encode(out.read_bytes()).decode()
    out.unlink(missing_ok=True)
    return "data:image/jpeg;base64," + data, False


def find(key: str):
    """Substring match, because macOS screenshot filenames carry a narrow
    no-break space before AM/PM that no literal path will ever match."""
    for folder in SOURCES:
        if not folder.exists():
            continue
        for p in sorted(folder.iterdir()):
            if p.name.startswith('.'):
                continue
            if key in p.stem:
                return p
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write data/seed.json")
    args = ap.parse_args()

    from collections import Counter
    items, missing, total_kb = [], [], 0
    lifted_count = Counter()
    for stem, tags in CATALOG.items():
        src = find(stem)
        if not src:
            missing.append(stem)
            continue
        thumb, lifted = to_thumb(src)
        total_kb += len(thumb) / 1024
        lifted_count[lifted] += 1
        item = {**tags, "photo": thumb, "source_photo": src.name, "cutout": lifted,
                "fits_now": None, "comfort": None, "wear_count": 0, "last_worn": None}
        items.append(item)
        flag = "  ?" if item["uncertain_fields"] else ""
        print(f"{item['name']:<36} {item['category']:<10} warmth {item['warmth']} "
              f"formality {item['formality_range']}{flag}")

    # The eight tagged earlier already live in closet.json; they need a thumbnail
    # and nothing else, so the seed is the complete wardrobe rather than a second
    # partial one.
    for prior in lib.load_closet()["items"]:
        src = lib.PHOTOS / "closet" / (prior.get("source_photo") or "")
        if not src.exists():
            missing.append(prior["id"])
            continue
        prior = {k: v for k, v in prior.items() if k != "formality"}
        prior["photo"], lifted = to_thumb(src)
        prior["cutout"] = lifted
        lifted_count[lifted] += 1
        total_kb += len(prior["photo"]) / 1024
        items.append(prior)
        print(f"{prior['name']:<36} {prior['category']:<10} warmth {prior['warmth']} "
              f"formality {prior.get('formality_range')}")

    print(f"\n{len(items)} items, ~{total_kb/1024:.1f} MB of thumbnails", file=sys.stderr)
    print(f"backgrounds lifted by Vision: {lifted_count[True]}  ·  "
          f"left for the app to try: {lifted_count[False]}", file=sys.stderr)
    if missing:
        print(f"couldn't find source photos for: {', '.join(missing)}", file=sys.stderr)

    from collections import Counter
    print("by category: " + ", ".join(f"{k} {v}" for k, v in
          sorted(Counter(i["category"] for i in items).items())), file=sys.stderr)

    if not args.apply:
        print("\nDry run — nothing written. Re-run with --apply.", file=sys.stderr)
        return

    lib.write_json(lib.DATA / "seed.json", {"version": 1, "items": items})
    print(f"\nWrote {lib.DATA / 'seed.json'}", file=sys.stderr)
    print("Import it from the app: Closet → Import.", file=sys.stderr)


if __name__ == "__main__":
    main()
