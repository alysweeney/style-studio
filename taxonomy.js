// The shared vocabulary. Structure lives here, never hardcoded in app.js —
// same split as beats.js/curriculum.js in couch-to-novel.
//
// taxonomy.md is the prose version of this file and the two must agree. If you
// change a scale here, change it there.

// ---------- Warmth ----------
// An item's warmth is its insulation, not its season vibe: a thin linen
// long-sleeve is 1, not 3. An outfit's warmth is the sum of its layers.
export const WARMTH_EXAMPLES = [
  { v: 0, eg: 'tank, sandals, bare legs' },
  { v: 1, eg: 'tee, thin blouse, shorts, sneakers' },
  { v: 2, eg: 'long-sleeve tee, jeans, light cardigan' },
  { v: 3, eg: 'sweater, thick trousers, boots, denim jacket' },
  { v: 4, eg: 'heavy knit, lined trousers, tall boots' },
  { v: 5, eg: 'winter coat, parka' },
];

// Daytime high (°F) -> [min, max] total outfit warmth. Upper bound exclusive.
export const WARMTH_BANDS = [
  { below: 25, target: [20, 26] },
  { below: 35, target: [16, 20] },
  { below: 45, target: [13, 16] },
  { below: 55, target: [10, 13] },
  { below: 65, target: [7, 10] },
  { below: 75, target: [5, 7] },
  { below: 85, target: [3, 5] },
  { below: Infinity, target: [2, 4] },
];

// ---------- Formality ----------
// Stored per item as a RANGE, not a point. A plain white tee genuinely works
// at 2 and at 4; a burgundy baseball raglan only works at 2. Treating this as
// a single number made the engine refuse the best outfit in the closet — see
// CHECKS.md, 2026-08-13.
export const FORMALITY = [
  { v: 1, name: 'Lounge', hint: 'only at home' },
  { v: 2, name: 'Casual', hint: 'errands, dog walk' },
  { v: 3, name: 'Smart casual', hint: 'coffee, office-adjacent' },
  { v: 4, name: 'Polished', hint: 'dinner, meeting' },
  { v: 5, name: 'Formal', hint: 'wedding, black tie' },
];

// ---------- The two things a photo can't tell you ----------

// Fit is point-in-time, not a quality judgment. Aly's framing, 2026-08-13:
// she doesn't keep clothes that look genuinely bad on her, so "badly cut" was
// never a real category. What IS real is a garment that doesn't fit her body
// *right now* but will again — pregnancy, a weight change, post-surgery. So
// this is a reversible shelf, not a verdict, and the wording has to make that
// obvious or she won't use it honestly.
export const FIT = [
  { v: true, name: 'Fits now', hint: 'in rotation' },
  { v: false, name: 'Not right now', hint: 'packed away, will fit again' },
];

// Three points, not five. Five was more precision than she'd use, and the real
// decision is coarse.
export const COMFORT = [
  { v: 1, name: 'Low', hint: "worth it, but I'll feel it" },
  { v: 2, name: 'Medium', hint: 'fine all day' },
  { v: 3, name: 'High', hint: "forget it's on" },
];

// Comfort is an OUTFIT rule, not an item rule. A single scratchy or stiff piece
// is fine next to comfortable ones; a whole outfit of them is why she'd end up
// back in leggings. One low-comfort piece per outfit, no more.
export const MAX_LOW_COMFORT_PER_OUTFIT = 1;

// ---------- Enums for the add-item form ----------
export const CATEGORY = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'bag', 'accessory'];
export const COLOR_FAMILY = ['neutral', 'earth', 'cool', 'warm', 'jewel', 'pastel'];
export const VALUE = ['light', 'mid', 'dark'];
export const SATURATION = ['muted', 'medium', 'saturated'];
export const TEXTURE = ['smooth', 'crisp', 'ribbed', 'nubby', 'fuzzy', 'slick', 'drapey-soft'];
export const PATTERN = ['solid', 'stripe', 'check', 'floral', 'graphic', 'print'];
export const SILHOUETTE = ['fitted', 'straight', 'relaxed', 'oversized'];
export const RISE = ['low', 'mid', 'high', 'n/a'];
export const LEG = ['skinny', 'straight', 'wide', 'barrel', 'flare', 'n/a'];
export const SEASONS = ['spring', 'summer', 'fall', 'winter'];

// Which slots an outfit is built from, in the order they're shown.
export const SLOTS = ['top', 'bottom', 'outerwear', 'shoes'];

// WMO weather codes -> plain language.
export const WMO = {
  0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'freezing fog', 51: 'light drizzle', 53: 'drizzle',
  55: 'heavy drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 80: 'rain showers',
  81: 'rain showers', 82: 'heavy showers', 95: 'thunderstorm',
};
