// Background removal, checked against synthetic images.
//
// The interesting property is connectivity: a white tee on a white backdrop has
// to keep its body, because the body isn't reachable from the border without
// crossing the garment's outline. A naive "delete every white pixel" would gut
// half of Aly's closet, so that case gets its own test.

let failures = 0;
function ok(label, cond, detail) {
  if (cond) print(`  ok    ${label}`);
  else { failures++; print(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

// Build a {data,width,height} the same shape canvas getImageData returns.
function img(width, height, paint) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { data, width, height };
}
const alphaAt = (im, x, y) => im.data[(y * im.width + x) * 4 + 3];

const WHITE = [255, 255, 255], BLACK = [20, 20, 20], GREY = [232, 232, 230];

print('\nFinding the backdrop');
const onWhite = img(40, 40, (x, y) => (x > 12 && x < 28 && y > 12 && y < 28 ? BLACK : WHITE));
ok('picks white off a white border', estimateBackground(onWhite).rgb[0] > 250);
ok('reports the border agreeing with itself', estimateBackground(onWhite).share === 1);
const greyBg = img(40, 40, (x, y) => (y > 20 ? BLACK : GREY));
ok('picks a grey studio sweep too', Math.abs(estimateBackground(greyBg).rgb[0] - 232) < 6);

print('\nA garment on a plain backdrop');
const plain = img(40, 40, (x, y) => (x > 12 && x < 28 && y > 12 && y < 28 ? BLACK : WHITE));
const r1 = removeBackground(plain);
ok('succeeds', r1.ok, r1.reason);
ok('removes roughly the backdrop area', r1.removed > 0.7 && r1.removed < 0.9, `removed ${r1.removed}`);
ok('corner is transparent', alphaAt(plain, 0, 0) === 0);
ok('garment centre is untouched', alphaAt(plain, 20, 20) === 255);

print('\nConnectivity — the case that matters');
// A pale garment with an enclosed pale interior: a ring of dark on white, with
// white inside it. The inside must survive even though it's the backdrop colour.
const donut = img(40, 40, (x, y) => {
  const dx = x - 20, dy = y - 20, d = Math.sqrt(dx * dx + dy * dy);
  return d > 8 && d < 16 ? BLACK : WHITE;
});
const r2 = removeBackground(donut);
ok('succeeds', r2.ok, r2.reason);
ok('outside the ring is removed', alphaAt(donut, 0, 0) === 0);
ok('ENCLOSED backdrop-coloured pixels are kept', alphaAt(donut, 20, 20) === 255);

print('\nRefusing rather than mangling');
// This used to assert that a brown-ramp "wood floor" was refused. Measured
// against Aly's real photos that was the wrong call: the fill lifts her
// trousers off a wood floor cleanly, and refusing lost a usable cut-out. What
// should actually be refused is a background with no coherent colour at all.
let seed = 7;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const confetti = img(40, 40, () => [rand() * 255, rand() * 255, rand() * 255]);
const r3 = removeBackground(confetti);
ok('declines a background with no dominant colour', !r3.ok && r3.reason === 'textured', r3.reason);
ok('leaves every pixel opaque when it declines', alphaAt(confetti, 5, 5) === 255);

// The regression that prompted the median rewrite: a crumpled white sheet is
// smooth but shaded, running roughly 200-255 across the frame. Bucket matching
// called that noise and refused 28 of 36 real photos.
const sheet = img(60, 60, (x, y) => {
  const shade = 208 + Math.round(40 * Math.sin(x / 9) * Math.cos(y / 11));
  return (x > 20 && x < 40 && y > 20 && y < 40) ? BLACK : [shade, shade, shade - 2];
});
const rSheet = removeBackground(sheet);
ok('lifts a garment off a shaded, crumpled sheet', rSheet.ok, rSheet.reason);
ok('and keeps the garment', alphaAt(sheet, 30, 30) === 255);
ok('while clearing the sheet', alphaAt(sheet, 1, 1) === 0);

const blank = img(40, 40, () => WHITE);
const r4 = removeBackground(blank);
ok('declines an image that is all backdrop', !r4.ok, r4.reason);
ok('that failure is reported as eating the garment', r4.reason === 'ate-the-garment', r4.reason);

const noBackdrop = img(40, 40, (x, y) => (x < 39 && y < 39 && x > 0 && y > 0 ? BLACK : BLACK));
const r5 = removeBackground(noBackdrop);
ok('declines when the garment fills the frame', !r5.ok, r5.reason);

print('\nTolerance');
// JPEG noise around a white backdrop must still read as one colour.
const noisy = img(40, 40, (x, y) => {
  if (x > 12 && x < 28 && y > 12 && y < 28) return BLACK;
  const v = 246 + Math.floor(rand() * 9);
  return [v, v, v];
});
const r6 = removeBackground(noisy);
ok('a slightly noisy backdrop still lifts', r6.ok, r6.reason);
ok('and the garment survives it', alphaAt(noisy, 20, 20) === 255);


print('\nColour inference');
const solid = (rgb) => img(20, 20, () => rgb);
const desc = (rgb) => describeColour(solid(rgb));
ok('white reads light and neutral', desc([250,250,250]).value === 'light' && desc([250,250,250]).color_family === 'neutral');
ok('black reads dark and neutral', desc([18,18,18]).value === 'dark' && desc([18,18,18]).color_family === 'neutral');
ok('mid grey reads mid', desc([128,128,130]).value === 'mid');
ok('indigo denim reads cool', desc([40,50,110]).color_family === 'cool');
ok('olive reads earth', desc([100,105,55]).color_family === 'earth');
ok('camel reads earth', desc([170,130,80]).color_family === 'earth');
ok('burgundy reads warm', desc([120,30,45]).color_family === 'warm');
ok('a saturated scarf reads saturated', desc([230,110,20]).saturation === 'saturated');
ok('a muted neutral reads muted', desc([200,198,196]).saturation === 'muted');
// Transparent pixels are the backdrop, not the garment: a black tee cut out of a
// white sheet must read as dark, not as an average of the two.
const cutTee = img(30, 30, (x, y) => (x > 8 && x < 22 && y > 8 && y < 22 ? [20,20,20] : [252,252,252]));
for (let p = 0; p < 30*30; p++) { const x = p % 30, y = (p/30)|0; if (!(x>8&&x<22&&y>8&&y<22)) cutTee.data[p*4+3] = 0; }
ok('ignores transparent pixels', describeColour(cutTee).value === 'dark');

print(failures ? `\n${failures} failure(s)\n` : '\nall cutout checks passed\n');
if (failures) throw new Error(`${failures} cutout check(s) failed`);
