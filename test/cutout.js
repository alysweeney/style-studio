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
// A textured background — Aly's trousers on a wood floor. No uniform colour to
// fill from, so it must decline instead of chewing holes in the garment.
let seed = 7;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const wood = img(40, 40, () => { const v = 90 + rand() * 120; return [v, v * 0.7, v * 0.45]; });
const r3 = removeBackground(wood);
ok('declines a textured background', !r3.ok && r3.reason === 'textured', r3.reason);
ok('leaves every pixel opaque when it declines', alphaAt(wood, 5, 5) === 255);

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

print(failures ? `\n${failures} failure(s)\n` : '\nall cutout checks passed\n');
if (failures) throw new Error(`${failures} cutout check(s) failed`);
