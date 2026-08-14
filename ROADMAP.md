# Roadmap

Written 2026-08-14, after looking at Alta and Acloset. The point of this file is
to be honest about what's built, what's reachable, and what isn't — so we can
pick deliberately rather than chase features.

## Where the bar is

**Alta** — digital closet, daily outfit from weather, avatar virtual try-on,
travel packing lists, wishlist with price drops, receipts-to-closet. Free, TIME
Best Invention 2025, CFDA partnership. Uses Meta's Segment Anything for cutouts;
has processed 20M+ images.

**Acloset** — smart registration (detects every garment in a mirror selfie and
converts it to a clean product image), AI stylist that analyses your colours and
body type, conversational refinement ("make it more formal?"), thumbs-down /
edit / save on each suggestion.

**Aly's steer, 2026-08-14:** Alta is closer to what she wants — an elevated
"Clueless closet" — with Acloset's smart registration and colour/body analysis
folded in. Best of both.

That reads as a clear priority on *how it looks and feels* over how much it can
do. A Clueless closet is a beautiful rotating rack you enjoy opening, not a
feature list. So visual quality of the closet and the outfit — cutouts, scale,
composition, typography, the pleasure of browsing — outranks new capabilities.

Both are funded products with teams. We will not match avatar try-on. We can
match or beat them on the thing this project was actually started for: not
"what should I wear", but **"why does this work, and what am I missing"**.

---

## Built and working

| | |
|---|---|
| Shared vocabulary between pins and closet | `taxonomy.md` / `taxonomy.js` |
| Style DNA distilled from ~300 of her pins | `data/style-dna.md` |
| Rules engine — warmth, fit, laundry, formality, recency | `outfits.js`, 45 checks |
| Reasoning generated free from the scoring signals | `explain()` |
| Cutouts via Apple's segmentation model — **36 of 36** | `tools/liftsubject` |
| Flat-lay composition | `styles.css` |
| Bulk add, HEIC, one set of answers per batch | `app.js` |
| Gap list ranked by outfits unlocked | `biggestGap()` |
| Live PWA, installable, free hosting | GitHub Pages |
| Optional Claude composition | `scripts/morning.py` |

## Known defects

1. **Hangers ride along.** Vision treats garment and hanger as one subject.
   Aly: fine for now.
2. **Model shots stay model shots.** A cutout of a person wearing clothes is a
   cutout of a person. Only fix is a garment-only photo.
3. **The in-app flood fill is much weaker than the Mac path.** Photos added on
   the phone get the colour fill, which fails on pale-on-pale. See #4.

---

## Candidates, in the order I'd do them

*Reordered after her steer toward Alta's feel: the closet as an object worth
browsing comes before anything that adds capability.*

### 0. The closet as a place you want to look at — *the Clueless rack*
Currently the closet is a plain grid of tiles and the flat-lay is one card. The
elevated version is a browsable wardrobe: garments on a consistent sweep at a
consistent scale (Vision's crop-to-subject already gives us this), grouped the
way a real rail is — by category, then by colour — with generous spacing and
real typography. This is presentation work on data that already exists, and it
is the single biggest gap between what we have and what Alta feels like.

### 1. Bring Vision-quality cutouts to the phone — *high value, medium effort, free*
Right now the good cutout only happens in `scripts/seed.py` on the Mac. Anything
added from the phone gets the weaker flood fill. Two routes: tell her to use
iOS's own subject lift (long-press the garment in Photos) before adding, which
is the same class of model and costs nothing; or ship a small ONNX segmentation
model in the PWA and cache it in the service worker. The first is free and
immediate, the second is properly seamless.

### 2. Outfit history and a style calendar — *high value, low effort, free*
The wear log already exists and nothing reads it back. Seeing what you actually
wore, and how often each piece gets used, is the evidence the gap list needs to
stop being a guess. Acloset and Alta both have this.

### 3. Smart registration — *high value, medium effort, small one-time cost*
Detecting several garments in one mirror selfie needs object detection, not
foreground segmentation — Vision merges everything into one instance (tested,
2026-08-14). Claude's vision can return bounding boxes per garment; crop each
box, run each crop through `liftsubject`. Cost is per photo added, not per day,
so realistically a few cents for a whole wardrobe.

### 4. Conversational refinement — *medium value, low effort, free-ish*
"Make it more formal", "something warmer", "no jeans today". Most of these map
onto filters that already exist, so a small phrase parser handles the common
cases for nothing, and only genuinely open-ended requests would need a model.

### 5. Colour analysis — *uncertain value, low effort, small cost*
Acloset's "Spring Bright" is seasonal colour analysis. It's a real framework and
Claude can do it from a photo in good light. Worth doing **only** if she wants
it: it's a judgment about her body and colouring, which is a different and more
personal thing than "these are the shapes your boards keep showing", and it
should be her call rather than a feature that appears.

### 6. Packing lists — *medium value, medium effort, free*
Destination plus dates plus the forecast, run through the same rules engine over
several days. Entirely deterministic.

### Not planned
**Avatar virtual try-on.** Alta is exploring SAM 3D for this. It's a research
problem with a team behind it, not a weekend feature, and getting it slightly
wrong is worse than not having it.

---

## The thing worth protecting

Alta and Acloset both answer "what should I wear today". Neither tells you *why*
an outfit works in terms of your own saved images, and neither says "you own
three of the four things your boards keep showing, here is the fourth."

That came out of reading her actual pins and finding two distinct wardrobes in
them. It is the reason this exists rather than downloading Alta, and every
feature above should be judged on whether it strengthens or dilutes it.
