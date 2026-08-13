# Style Taxonomy (draft — v1, needs Aly's approval)

The whole project rests on this file. A Pinterest board and a closet are describing the
same things in different languages: pins are *vibes* (proportion, texture, color
temperature, styling moves), closets are *objects* (a gray hoodie, size M). Nothing
works until both are described with the same words.

Every field below appears in **both** the closet catalog and the style DNA. That
symmetry is the point — it's what makes "your pins want X, your closet has Y" a
computable statement instead of a feeling.

---

## Part 1 — Item fields (the closet)

### Identity
- `id` — stable slug, e.g. `tee-white-boxy-01`
- `name` — how Aly would refer to it out loud ("the cropped white tee")
- `category` — top | bottom | dress | outerwear | shoes | bag | accessory
- `subcategory` — tee, blouse, knit, jeans, trousers, skirt, sneaker, boot, …
- `source_photo` — path under `photos/closet/`

### Color
- `color_primary` — plain-language name
- `color_secondary` — nullable
- `color_family` — neutral | earth | cool | warm | jewel | pastel
- `value` — light | mid | dark
- `saturation` — muted | medium | saturated

Color family and value matter more than the exact name. Most outfit failures are
value clashes (all-mid, no contrast) or family clashes (cool gray next to warm camel),
not literal color clashes.

### Material & surface
- `fabric` — cotton, denim, wool, linen, poly, knit blend, leather, …
- `texture` — smooth | crisp | ribbed | nubby | fuzzy | slick | drapey-soft
- `pattern` — solid | stripe | check | floral | graphic | print

Texture is the most-ignored and highest-leverage field. An outfit of three smooth
items reads flat and cheap regardless of color. Pinterest aesthetics are usually
carrying two or three textures at once.

### Shape
- `structure` — 1–5 (1 = fully slouchy/drapey, 5 = tailored and holds its own shape)
- `silhouette` — fitted | straight | relaxed | oversized
- `length` — tops: cropped/hip/long/tunic · bottoms: mini/knee/midi/ankle/full
- `rise` — bottoms only: low | mid | high
- `leg` — bottoms only: skinny | straight | wide | barrel | flare

### Function
- `warmth` — 0–5 (see the warmth model below; this is the weather engine's input)
- `formality` — 1–5
  1. loungewear (only at home)
  2. casual (errands, dog walk)
  3. smart casual (coffee with a friend, office-adjacent)
  4. polished (dinner, meeting, event-adjacent)
  5. formal (wedding, black tie)
- `seasons` — subset of spring/summer/fall/winter

### Reality check
- `fit_status` — great | fine | poor — **does it actually fit right now**
- `comfort` — 1–5 — will she keep it on all day
- `condition` — new | good | worn | retire

These three exist because the failure mode of every closet app is recommending the
thing that looks good on paper and feels wrong at 8am. Anything with `fit_status: poor`
or `comfort: 1` never gets suggested, no matter how well it scores.

### History (populated by the app, not by cataloging)
- `wear_count`, `last_worn`, `outfit_ids`

---

## Part 2 — Style DNA fields (the Pinterest boards)

Extracted from pins, in the same vocabulary, so the two sides can be compared directly.

- **Palette** — dominant neutrals, the accent colors, and the value distribution
  (how much light/dark contrast a typical pin carries)
- **Texture frequency** — which textures appear, and how many per outfit
- **Silhouette vocabulary** — which shapes recur, and in what combination
- **Proportion rules** — the actual formulas. "Volume on top, slim on bottom."
  "Cropped top + high rise." "Long line over straight leg." These are the recipes.
- **Structure mix** — how many structured vs. drapey pieces per outfit
- **Formality center of gravity** — where on the 1–5 scale the boards actually sit
- **Styling moves** — tuck (full/french/none), cuff, sleeve push, layer count,
  shoe-to-hem relationship, how outerwear is worn (on, open, over shoulders)
- **Absences** — what is conspicuously *never* in the pins

Absences are as informative as presences and get their own section. If ninety pins
contain zero leggings and zero oversized crewnecks, that is the single most useful
sentence in this entire project.

---

## Part 3 — The warmth model

The weather engine is deterministic and lives here rather than in code comments,
so it can be argued with.

**Per-item warmth (0–5):**

| Value | Examples |
|---|---|
| 0 | tank, sandals, bare legs |
| 1 | tee, thin blouse, shorts, thin skirt, sneakers |
| 2 | long-sleeve tee, jeans, chinos, light cardigan |
| 3 | sweater, thick trousers, boots, denim/light jacket |
| 4 | heavy knit, lined pants, wool overshirt, tall boots |
| 5 | winter coat, parka, insulated anything |

**An outfit's warmth is the sum of its layers.** Target bands by daytime high:

| High (°F) | Target total |
|---|---|
| 85+ | 2–4 |
| 75–84 | 3–5 |
| 65–74 | 5–7 |
| 55–64 | 7–10 |
| 45–54 | 10–13 |
| 35–44 | 13–16 |
| 25–34 | 16–20 |
| under 25 | 20+ |

**Modifiers applied before band lookup:**
- precipitation probability > 40% → require a `water_ok` outer layer and non-suede shoes
- wind > 20 km/h → +1 to target (wind strips a layer's worth of warmth)
- daily swing > 20°F → require at least one removable layer
- "mostly indoors" day flag → cap the target at the low end of the band

---

## Part 4 — The gap list

The feature that stops the wasteful buying, and the reason the taxonomy is symmetric.

For each recurring proportion rule in the style DNA, the engine checks which slots
the closet can already fill and which are empty. The output is deliberately not
"here are things to buy" — it's ranked by **how many currently-unwearable outfits
one purchase unlocks**:

> Four of your tops want a mid-rise straight-leg jean in a mid wash. You own zero.
> That single purchase unlocks 4 outfits. It's the only thing on this list worth buying.

An item that unlocks one outfit does not make the list.

---

## Open questions for Aly

1. Is formality 1–5 the right granularity, or does her actual life only have three modes?
2. Should `fit_status: poor` items be hidden entirely, or surfaced separately as a
   "tailor or donate" list?
3. Does she want the gap list at all in v1, or does it need a few weeks of real wear
   data before it's trustworthy?
