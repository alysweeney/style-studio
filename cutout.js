// Background removal for garment photos.
//
// The flat-lay only works if pieces sit on a shared sweep instead of floating
// in their own rectangles. Listing screenshots almost always have a flat, near
// uniform backdrop, which is exactly the case a flood fill handles well.
//
// It deliberately does NOT try to be a segmentation model. A textured
// background — a wood floor, a rug, a bed — has no uniform colour to fill from,
// and this will correctly refuse rather than hack the garment apart. That case
// is better solved by iOS's own subject lift before upload.
//
// Everything here works on a plain {data, width, height} object rather than a
// real ImageData, so the algorithm is testable under JavaScriptCore with no
// canvas involved.

const idx = (x, y, w) => (y * w + x) * 4;

// How far apart two colours are, as the largest single-channel gap. More
// intuitive to tune than euclidean distance and cheaper than a colour space
// conversion — a backdrop that reads as "the same white" stays within ~25.
function distance(d, a, b) {
  return Math.max(
    Math.abs(d[a] - d[b]),
    Math.abs(d[a + 1] - d[b + 1]),
    Math.abs(d[a + 2] - d[b + 2])
  );
}

// The backdrop is whatever colour dominates the border. Quantising to 16-level
// buckets stops JPEG noise splitting one colour across many keys.
export function estimateBackground({ data, width, height }) {
  const counts = new Map();
  const note = (x, y) => {
    const i = idx(x, y, width);
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const cur = counts.get(key);
    if (cur) { cur.n++; cur.r += data[i]; cur.g += data[i + 1]; cur.b += data[i + 2]; }
    else counts.set(key, { n: 1, r: data[i], g: data[i + 1], b: data[i + 2] });
  };
  for (let x = 0; x < width; x++) { note(x, 0); note(x, height - 1); }
  for (let y = 0; y < height; y++) { note(0, y); note(width - 1, y); }

  let best = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  if (!best) return { rgb: [255, 255, 255], share: 0 };

  const total = 2 * width + 2 * height;
  return {
    rgb: [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)],
    share: best.n / total,   // how much of the border agrees; low means textured
  };
}

// Flood fill inward from the border. Connectivity is the whole point: a white
// tee on a white backdrop keeps its body, because the body isn't reachable from
// the edge without crossing the garment's own outline.
export function removeBackground(img, { tolerance = 34, feather = true } = {}) {
  const { data, width, height } = img;
  const bg = estimateBackground(img);

  // A border that doesn't agree with itself isn't a backdrop, it's a scene.
  // Bail before touching a single pixel.
  if (bg.share < 0.5) {
    return { ok: false, reason: 'textured', removed: 0, bg: bg.rgb };
  }

  const [br, bg_, bb] = bg.rgb;
  const ref = new Uint8ClampedArray([br, bg_, bb]);
  const near = (i, tol) => Math.max(
    Math.abs(data[i] - ref[0]), Math.abs(data[i + 1] - ref[1]), Math.abs(data[i + 2] - ref[2])
  ) <= tol;

  const out = new Uint8Array(width * height);   // 1 = background
  const queue = new Int32Array(width * height);
  let head = 0, tail = 0;

  const push = (x, y) => {
    const p = y * width + x;
    if (out[p]) return;
    if (!near(p * 4, tolerance)) return;
    out[p] = 1;
    queue[tail++] = p;
  };

  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }

  while (head < tail) {
    const p = queue[head++];
    const x = p % width, y = (p / width) | 0;
    if (x > 0) push(x - 1, y);
    if (x < width - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < height - 1) push(x, y + 1);
  }

  let removed = 0;
  for (let p = 0; p < out.length; p++) {
    if (out[p]) { data[p * 4 + 3] = 0; removed++; }
  }

  // Soften the cut. Without this every edge is a hard jag, which looks worse
  // against the sweep than the original rectangle did. A kept pixel touching
  // the background gets alpha in proportion to how unlike the backdrop it is.
  if (feather) {
    const wide = tolerance * 2;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const p = y * width + x;
        if (out[p]) continue;
        const touches = out[p - 1] || out[p + 1] || out[p - width] || out[p + width];
        if (!touches) continue;
        const d = Math.max(
          Math.abs(data[p * 4] - ref[0]),
          Math.abs(data[p * 4 + 1] - ref[1]),
          Math.abs(data[p * 4 + 2] - ref[2])
        );
        if (d < wide) data[p * 4 + 3] = Math.round(255 * (d / wide));
      }
    }
  }

  const share = removed / (width * height);

  // Two ways this goes wrong, both worth catching rather than shipping:
  // almost nothing went (there was no backdrop to find), or almost everything
  // went (the garment was close enough to the backdrop to be eaten).
  if (share < 0.04) return { ok: false, reason: 'nothing-to-remove', removed: share, bg: bg.rgb };
  if (share > 0.92) return { ok: false, reason: 'ate-the-garment', removed: share, bg: bg.rgb };

  return { ok: true, removed: share, bg: bg.rgb };
}
