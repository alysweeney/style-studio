# Checks

Meta-rule: every time Aly corrects an item's tags, an outfit's logic, or the tone of a
recommendation, add a dated entry below. Verify against this list before every run.
A mistake is allowed once; repeating it is a process failure.

## 2026-08-13 — established at project start

These are pre-commitments, not corrections. They come from the failure modes Aly
described in the brief and from conventions inherited from `finance-tracker`.

- **Fit is point-in-time, not a verdict.** Corrected by Aly 2026-08-13: the first
  draft treated `fit_status: poor` as "this looks bad on me", which isn't a real
  category — she doesn't keep clothes that look genuinely bad. What *is* real is a
  garment that doesn't fit her body right now but will again (pregnancy, a weight
  change). So the field is `fits_now`, it's reversible, the item stays in the closet,
  and the wording in the UI must make clear it's a shelf and not a judgment. Never
  phrase it as a quality rating.

- **Low comfort excludes an outfit, never an item.** Also Aly, 2026-08-13. One
  uncomfortable piece alongside comfortable ones is a fine trade; an outfit that is
  *entirely* low-comfort is what sends her back to leggings. So `comfort` is scored at
  outfit level (`MAX_LOW_COMFORT_PER_OUTFIT`), and `wearable()` must not filter a
  low-comfort item on its own. Comfort is 1–3 (low/medium/high), not 1–5 — five points
  was more precision than the decision needs.
- **The six-tshirt problem is the baseline, not a bug to shame.** Wear data gets
  described, never moralized. No "you wore leggings 9 days in a row" framing.
- **Describe before predicting.** Per `feedback_evidence_before_modeling`: the first
  two weeks produce a description of what's actually in the closet and what the boards
  actually contain. No trend claims, no "your style is X" conclusions, and no gap list
  purchases recommended off thin data.
- **Cataloging is dry-run by default.** `catalog.py` writes nothing without `--apply`.
  Vision tagging will be wrong sometimes; every batch gets reviewed before it lands in
  `closet.json`.
- **Secrets live in `~/.config/personal-automation/anthropic.env`**, never in this repo.
  `.gitignore` covers `photos/` too — clothing photos and Pinterest saves don't need to
  be in version control.
- **Weather is fetched, never assumed.** If the Open-Meteo call fails, the app says so
  and shows no outfit rather than guessing a temperature.
- **Fit and comfort are set in the app's add-item flow, not by hand in JSON.**
  Aly's call, 2026-08-13: since she'll be uploading clothing photos through the app
  anyway, the two fields a photo can't determine belong in that same screen as
  selectable controls. The add-item flow must therefore visually separate what was
  auto-tagged from what only she can answer — the second group is not optional and
  an item can't be saved as recommendable without it. Supersedes the earlier plan of
  editing `closet.json` manually after cataloging.

- **Bulk import sets fit and comfort once for the batch, not per item.** Aly,
  2026-08-14: being asked "tell me about this" after every photo is how a wardrobe
  never gets loaded. The import screen applies one visible default to all of them
  (fits now, medium comfort) and she taps only the exceptions. This is a stated,
  editable default rather than a silent guess, which is what keeps it compatible
  with the rule that the engine never invents these two fields.

- **Tune the cutout against real photos, not synthetic ones.** The first version
  identified the backdrop by bucketing border pixels into 16 levels and taking the
  most common bucket. It passed every synthetic test and then lifted **8 of 36** of
  Aly's actual photos, because a crumpled white sheet spans four buckets. Median
  colour plus a tolerance passes **33 of 36**. A synthetic test that asserted a
  wood floor should be *refused* was also wrong — the fill handles it, and refusing
  lost a good cut-out. Any future change here gets measured against the real seed
  before it gets believed.

- **The app must work with no API key.** Aly asked whether this could be free, on
  2026-08-14, and the honest answer was yes: the scorer already knows which rule each
  outfit leans on, so `explain()` writes the reasoning from those signals for nothing.
  Claude is a phrasing upgrade, never a dependency. Any future feature that only works
  with a key needs a free path alongside it.

- **Never report a gap without its context.** "You have no bottoms" to someone who owns
  eight reads as broken. The gap is always relative to the season and dress level being
  asked for, so the sentence has to name both.

- **One purchase suggestion at a time, or none.** The gap list ranks by outfits
  unlocked and shows only the top entry. A list of five things to buy is the exact
  behavior this project exists to prevent.
