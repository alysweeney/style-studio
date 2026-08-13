// The rules engine: everything about an outfit that has a right answer.
//
// Warmth arithmetic, what fits, what's in the laundry, what she wore
// yesterday. Deliberately NOT the taste layer — which combination actually
// looks like her Pinterest boards is composed by Claude on the Mac and synced
// down (see README). This runs client-side so the app still works with
// nothing waiting for it.
//
// Pure functions only: no DOM, no network, no imports beyond taxonomy.
// That's what lets test/run.sh exercise it under JavaScriptCore.

import { WARMTH_BANDS, WMO, SLOTS, MAX_LOW_COMFORT_PER_OUTFIT } from './taxonomy.js';

export function warmthTarget(highF) {
  return WARMTH_BANDS.find((b) => highF < b.below).target.slice();
}

// Turn an Open-Meteo daily payload into everything the engine needs.
export function readForecast(raw, index = 0) {
  const d = raw.daily;
  const high = d.temperature_2m_max[index];
  const low = d.temperature_2m_min[index];
  const precip = d.precipitation_probability_max[index];
  const wind = d.wind_speed_10m_max[index];

  const target = warmthTarget(high);
  const modifiers = [];

  if (wind > 20) {
    target[0] += 1;
    target[1] += 1;
    modifiers.push(`${Math.round(wind)} km/h wind — counts a layer colder`);
  }
  if (precip > 40) modifiers.push(`${Math.round(precip)}% rain — needs a water-ok layer, no suede`);
  if (high - low > 20) modifiers.push(`${Math.round(high - low)}° swing — bring a layer you can shed`);

  return {
    date: d.time[index],
    high, low, precip, wind,
    conditions: WMO[d.weather_code[index]] || 'unclear',
    target,
    needsRain: precip > 40,
    modifiers,
  };
}

export function seasonOf(date = new Date()) {
  return ['winter', 'winter', 'spring', 'spring', 'spring', 'summer',
          'summer', 'summer', 'fall', 'fall', 'fall', 'winter'][date.getMonth()];
}

// The deterministic filter. Every rule here protects something specific.
export function wearable(item, { season, formality, recent = new Set() }) {
  if (item.condition === 'retire') return false;

  // Doesn't fit her body right now. Reversible — the item stays in the closet
  // and comes back when she flips it. Never a quality judgment.
  if (item.fits_now === false) return false;

  // Not yet rated by a human — don't guess on her behalf. A photo can't answer
  // either of these.
  if (item.fits_now == null || !item.comfort) return false;

  // NOTE: low comfort is deliberately NOT filtered here. One uncomfortable
  // piece in an otherwise comfortable outfit is fine; it's the all-low outfit
  // that sends her back to leggings. Enforced at outfit level in buildOutfits.

  if (!(item.seasons || []).includes(season)) return false;

  const [lo, hi] = item.formality_range || [item.formality, item.formality];
  if (formality < lo || formality > hi) return false;

  return !recent.has(item.id);
}

export function recentlyWorn(log = [], days = 3) {
  const cutoff = Date.now() - days * 864e5;
  const ids = new Set();
  for (const e of log) {
    if (new Date(e.date).getTime() >= cutoff) (e.item_ids || []).forEach((i) => ids.add(i));
  }
  return ids;
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

// How well a candidate set of pieces holds together. Not taste — just the
// mechanical things that reliably read as wrong.
function score(pieces, forecast) {
  const warmth = sum(pieces.map((p) => p.warmth || 0));
  const [lo, hi] = forecast.target;
  let s = 0;

  // Landing in the warmth band is the whole point; distance is a hard penalty.
  s -= warmth < lo ? (lo - warmth) * 10 : warmth > hi ? (warmth - hi) * 10 : 0;

  // Value contrast. Her boards run light-over-dark constantly, and an all-mid
  // outfit is the single most common way to look unconsidered.
  const values = new Set(pieces.map((p) => p.value));
  if (values.size > 1) s += 6;

  // Texture variety — two or three per outfit is the norm in her pins.
  const textures = new Set(pieces.map((p) => p.texture));
  s += Math.min(textures.size, 3) * 3;

  // Silhouette contrast: slim against wide is her dominant proportion rule.
  const sil = pieces.map((p) => p.silhouette);
  if (sil.includes('fitted') && (sil.includes('relaxed') || sil.includes('oversized'))) s += 8;

  // Too many loud patterns fight.
  const patterned = pieces.filter((p) => p.pattern && p.pattern !== 'solid').length;
  if (patterned > 1) s -= 5 * (patterned - 1);

  // Rain: something in the outfit has to cope.
  if (forecast.needsRain && !pieces.some((p) => p.water_ok)) s -= 8;

  // Comfortable outfits should win ties. Allowed but not preferred.
  s -= pieces.filter((p) => p.comfort === 1).length * 4;

  // Nudge toward things she hasn't worn much, without making it the driver.
  s -= sum(pieces.map((p) => Math.min(p.wear_count || 0, 10))) * 0.2;

  return { score: s, warmth };
}

// Build the best few outfits available. Exhaustive over a small closet, which
// is the realistic case; if it ever gets big, cap candidates per slot first.
export function buildOutfits(items, ctx, limit = 3) {
  const pool = items.filter((i) => wearable(i, ctx));
  const bySlot = Object.fromEntries(
    SLOTS.map((s) => [s, pool.filter((i) => i.category === s)])
  );
  const dresses = pool.filter((i) => i.category === 'dress');

  const bases = [];
  for (const top of bySlot.top) for (const bottom of bySlot.bottom) bases.push([top, bottom]);
  for (const d of dresses) bases.push([d]);

  const combos = [];
  for (const base of bases) {
    const layers = [null, ...bySlot.outerwear];
    const shoes = bySlot.shoes.length ? bySlot.shoes : [null];
    for (const layer of layers) {
      for (const shoe of shoes) {
        const pieces = [...base, layer, shoe].filter(Boolean);
        // The outfit-level comfort rule. One scratchy piece is a fine trade;
        // a whole outfit of them is the thing that loses to a hoodie.
        if (pieces.filter((p) => p.comfort === 1).length > MAX_LOW_COMFORT_PER_OUTFIT) continue;
        combos.push({ pieces, ...score(pieces, ctx.forecast) });
      }
    }
  }

  combos.sort((a, b) => b.score - a.score);

  // Don't return three variations on one idea — require each outfit to differ
  // from the ones above it by more than a single piece.
  const chosen = [];
  for (const c of combos) {
    const ids = new Set(c.pieces.map((p) => p.id));
    const tooSimilar = chosen.some((k) => {
      const overlap = k.pieces.filter((p) => ids.has(p.id)).length;
      return overlap >= Math.min(k.pieces.length, c.pieces.length) - 1;
    });
    if (!tooSimilar) chosen.push(c);
    if (chosen.length === limit) break;
  }
  return chosen;
}

// What's missing, ranked by how many otherwise-impossible outfits it unlocks.
// Deliberately returns at most one suggestion: a list of five things to buy is
// the exact behaviour this project exists to prevent.
export function biggestGap(items, ctx) {
  const pool = items.filter((i) => wearable(i, ctx));
  const counts = Object.fromEntries(SLOTS.map((s) => [s, pool.filter((i) => i.category === s).length]));
  const missing = SLOTS.filter((s) => counts[s] === 0);
  if (!missing.length) return null;

  // A missing slot blocks every combination of the slots that are populated.
  const blocked = SLOTS.filter((s) => counts[s] > 0).reduce((a, s) => a * counts[s], 1);
  return { slot: missing[0], alsoMissing: missing.slice(1), unlocks: blocked };
}
