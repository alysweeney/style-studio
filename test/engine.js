// Does the maths stay honest when the inputs are awkward?
//
// Runs under JavaScriptCore, which ships with macOS — no install, no Node.
// run.sh strips the ES module syntax and concatenates taxonomy + outfits
// ahead of this file.

let failures = 0;
function ok(label, cond, detail) {
  if (cond) { print(`  ok    ${label}`); }
  else { failures++; print(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
function eq(label, got, want) {
  ok(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// A stand-in for Aly's real catalog, same shapes as data/closet.json.
const rated = { fits_now: true, comfort: 3, wear_count: 0 };
const ALL = [
  { id: 'tee-white', category: 'top', warmth: 1, value: 'light', texture: 'smooth',
    silhouette: 'fitted', pattern: 'solid', seasons: ['spring','summer','fall','winter'],
    formality_range: [2, 4], water_ok: false, ...rated },
  { id: 'tee-stripe', category: 'top', warmth: 2, value: 'dark', texture: 'smooth',
    silhouette: 'relaxed', pattern: 'stripe', seasons: ['fall'], formality_range: [2, 3],
    water_ok: false, ...rated },
  { id: 'jeans', category: 'bottom', warmth: 2, value: 'dark', texture: 'crisp',
    silhouette: 'relaxed', pattern: 'solid', seasons: ['fall'], formality_range: [2, 3],
    water_ok: false, ...rated },
  { id: 'trousers', category: 'bottom', warmth: 2, value: 'dark', texture: 'drapey-soft',
    silhouette: 'relaxed', pattern: 'solid', seasons: ['fall'], formality_range: [3, 4],
    water_ok: false, ...rated },
  { id: 'cardigan', category: 'outerwear', warmth: 2, value: 'dark', texture: 'smooth',
    silhouette: 'relaxed', pattern: 'solid', seasons: ['fall'], formality_range: [2, 4],
    water_ok: false, ...rated },
];
const mild = { date: '2026-10-01', high: 62, low: 50, precip: 5, wind: 5,
               conditions: 'clear', target: [7, 10], needsRain: false, modifiers: [] };

print('\nWarmth bands');
eq('freezing maps to the top band', warmthTarget(10), [20, 26]);
eq('62F lands mid-scale', warmthTarget(62), [7, 10]);
eq('boundary is inclusive-below', warmthTarget(65), [5, 7]);
eq('heatwave clamps to the lightest band', warmthTarget(110), [2, 4]);

print('\nForecast modifiers');
const raw = (o) => ({ daily: { time: ['2026-10-01'], temperature_2m_max: [o.high],
  temperature_2m_min: [o.low], precipitation_probability_max: [o.p],
  wind_speed_10m_max: [o.w], weather_code: [o.c ?? 0] } });
const windy = readForecast(raw({ high: 62, low: 55, p: 0, w: 30 }));
eq('wind shifts the whole band up', windy.target, [8, 11]);
ok('wind is explained to the user', windy.modifiers.some((m) => m.includes('wind')));
const wet = readForecast(raw({ high: 62, low: 55, p: 80, w: 2 }));
ok('rain sets the flag', wet.needsRain === true);
const swingy = readForecast(raw({ high: 75, low: 45, p: 0, w: 2 }));
ok('a big swing asks for a shed-able layer', swingy.modifiers.some((m) => m.includes('swing')));

print('\nThe filter protects what it should');
const ctx = { season: 'fall', formality: 2, recent: new Set(), forecast: mild };
ok('a rated item passes', wearable(ALL[1], ctx));
ok('packed away is refused', !wearable({ ...ALL[1], fits_now: false }, ctx));
ok('unrated fit is refused rather than guessed', !wearable({ ...ALL[1], fits_now: null }, ctx));
ok('unrated comfort is refused rather than guessed', !wearable({ ...ALL[1], comfort: null }, ctx));
// Low comfort is an outfit-level rule, not an item-level one — a scratchy
// piece must still be reachable on its own.
ok('a low-comfort item is NOT filtered out by itself', wearable({ ...ALL[1], comfort: 1 }, ctx));
ok('retired is refused', !wearable({ ...ALL[1], condition: 'retire' }, ctx));
ok('wrong season is refused', !wearable({ ...ALL[1], seasons: ['summer'] }, ctx));
ok('worn yesterday is refused',
   !wearable(ALL[1], { ...ctx, recent: new Set(['tee-stripe']) }));

print('\nFormality is a range, not a point');
// The regression that started all this: a plain white tee must reach the
// tailored trousers, and a striped pocket tee must not.
ok('white tee reaches polished', wearable(ALL[0], { ...ctx, formality: 4 }));
ok('striped tee does not reach polished', !wearable(ALL[1], { ...ctx, formality: 4 }));
ok('trousers do not drop to casual', !wearable(ALL[3], { ...ctx, formality: 2 }));
ok('an item with only a scalar formality still works',
   wearable({ ...ALL[1], formality_range: undefined, formality: 2 }, ctx));

print('\nBuilding outfits');
const casual = buildOutfits(ALL, ctx);
ok('produces at least one outfit', casual.length > 0);
ok('every outfit has a top and a bottom', casual.every((o) =>
  o.pieces.some((p) => p.category === 'top') && o.pieces.some((p) => p.category === 'bottom')));
ok('never includes an unwearable piece', casual.every((o) =>
  o.pieces.every((p) => wearable(p, ctx))));
ok('respects the formality ceiling', buildOutfits(ALL, { ...ctx, formality: 4 })
  .every((o) => o.pieces.every((p) => (p.formality_range || [0, 9])[1] >= 4)));
ok('reported warmth equals the sum of its pieces', casual.every((o) =>
  o.warmth === o.pieces.reduce((a, p) => a + p.warmth, 0)));
ok('returns no more than the limit', buildOutfits(ALL, ctx, 2).length <= 2);

print('\nComfort is an outfit rule, not an item rule');
const oneLow = ALL.map((i) => (i.id === 'jeans' ? { ...i, comfort: 1 } : i));
ok('one low-comfort piece is allowed',
   buildOutfits(oneLow, ctx).some((o) => o.pieces.some((p) => p.comfort === 1)));
const allLow = ALL.map((i) => ({ ...i, comfort: 1 }));
eq('an all-low-comfort outfit is refused', buildOutfits(allLow, ctx), []);
ok('comfortable outfits outrank uncomfortable ones', (() => {
  const mixed = ALL.map((i) => (i.id === 'trousers' ? { ...i, comfort: 1 } : i));
  const best = buildOutfits(mixed, { ...ctx, formality: 3 })[0];
  return !best || best.pieces.every((p) => p.comfort !== 1);
})());

print('\nDegenerate closets do not throw');
eq('empty closet yields nothing', buildOutfits([], ctx), []);
eq('tops but no bottoms yields nothing', buildOutfits([ALL[0]], ctx), []);
ok('a closet of unrated items yields nothing',
   buildOutfits(ALL.map((i) => ({ ...i, fits_now: null })), ctx).length === 0);

print('\nThe gap list');
const gap = biggestGap(ALL, ctx);
ok('spots that there are no shoes', gap && gap.slot === 'shoes');
ok('quantifies what it would unlock', gap && gap.unlocks > 0);
ok('stays silent when nothing is missing', biggestGap(
  [...ALL, { id: 'sh', category: 'shoes', warmth: 1, seasons: ['fall'],
             formality_range: [2, 4], ...rated }], ctx) === null);


print('\nFree reasoning');
const wide = { ...mild, target: [5, 8] };
const ex1 = explain([ALL[0], ALL[2]], wide);       // fitted white top + relaxed jeans
ok('names the slim-over-wide formula', /slim top over a wide bottom/i.test(ex1.why), ex1.why);
ok('gives it a title', !!ex1.title);
ok('spots light-over-dark', /light over dark/i.test(ex1.why), ex1.why);
const ex2 = explain([ALL[1], ALL[3], ALL[4]], wide);
ok('always says something', ex2.why.length > 20, ex2.why);
ok('mentions the open layer', /worn open/i.test(ex2.how), ex2.how);
const cold = explain([ALL[0], ALL[2]], { ...mild, target: [14, 18], needsRain: false });
ok('admits when the outfit is too cold', /under today/i.test(cold.why), cold.why);
const rainy = explain([ALL[0], ALL[2]], { ...mild, target: [1, 9], needsRain: true });
ok('warns when nothing copes with rain', /rain/i.test(rainy.why), rainy.why);
const cropped = explain([{ ...ALL[0], length: 'cropped' }, { ...ALL[2], rise: 'high' }], wide);
ok('skips the tuck advice for a cropped top', /no tuck needed/i.test(cropped.how), cropped.how);
const tucked = explain([{ ...ALL[0], length: 'hip' }, { ...ALL[2], rise: 'high' }], wide);
ok('asks for a front tuck on a high rise', /front tuck/i.test(tucked.how), tucked.how);

print(failures ? `\n${failures} failure(s)\n` : '\nall engine checks passed\n');
if (failures) throw new Error(`${failures} engine check(s) failed`);
