// Render and wiring. All the interesting decisions live in outfits.js
// (the rules) and taxonomy.js (the vocabulary); this file only puts them on
// screen and takes input back.

import * as cloud from './cloud.js';
import { buildOutfits, readForecast, seasonOf, recentlyWorn, biggestGap, wearable } from './outfits.js';
import { removeBackground, describeColour } from './cutout.js';
import {
  CATEGORY, COLOR_FAMILY, VALUE, SATURATION, TEXTURE, PATTERN, SILHOUETTE,
  SEASONS, FORMALITY, FIT, COMFORT, SLOTS,
} from './taxonomy.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const state = {
  uid: null,
  closet: [],
  wearLog: [],
  forecast: null,
  composed: null,       // written by scripts/outfit.py, if it ran this morning
  formality: Number(localStorage.getItem('formality') || 2),
  queue: [],                                  // drafts waiting to be saved
  bulk: { fits_now: true, comfort: 2 },       // one set of answers for the batch
  expanded: null,
  unsub: [],
};

const todayISO = () => new Date().toISOString().slice(0, 10);

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid != null && kid !== false) n.append(kid.nodeType ? kid : String(kid));
  }
  return n;
}

function show(name) {
  $$('.view').forEach((v) => (v.hidden = v.id !== `view-${name}`));
  $$('#nav button[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- auth

function wireAuth() {
  if (!cloud.isConfigured) {
    $('#auth-unconfigured').hidden = false;
    $('#auth-form').hidden = true;
    return;
  }
  const fail = (e) => {
    const box = $('#auth-error');
    box.hidden = false;
    // Firebase codes are unreadable; say what to actually do about it.
    box.textContent = {
      'auth/invalid-credential': "That email and password don't match an account.",
      'auth/email-already-in-use': 'That email already has an account — sign in instead.',
      'auth/weak-password': 'Password needs to be at least 6 characters.',
      'auth/operation-not-allowed':
        'Email sign-in is switched off in the Firebase console — enable it under Authentication.',
      'auth/network-request-failed': 'No connection. Try again when you have signal.',
    }[e.code] || e.message;
  };
  const creds = () => [$('#auth-email').value.trim(), $('#auth-password').value];

  $('#auth-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    $('#auth-error').hidden = true;
    cloud.signIn(...creds()).catch(fail);
  });
  $('#auth-register').addEventListener('click', () => {
    $('#auth-error').hidden = true;
    const [email, pw] = creds();
    if (!email || pw.length < 6) return fail({ code: 'auth/weak-password' });
    cloud.register(email, pw).catch(fail);
  });
  $('#nav-signout').addEventListener('click', () => cloud.leave());
}

function onUser(user) {
  state.unsub.forEach((fn) => fn());
  state.unsub = [];

  if (!user) {
    state.uid = null;
    state.closet = [];
    $('#nav').hidden = true;
    return show('auth');
  }

  state.uid = user.uid;
  $('#nav').hidden = false;
  show('today');

  state.unsub.push(
    cloud.watchCloset(user.uid, (items) => { state.closet = items; renderToday(); renderCloset(); }),
    cloud.watchWearLog(user.uid, (log) => { state.wearLog = log; renderToday(); }),
    cloud.watchComposed(user.uid, todayISO(), (doc) => { state.composed = doc; renderToday(); }),
  );
  loadWeather();
}

// ---------------------------------------------------------------- weather

async function loadWeather() {
  const box = $('#weather');
  let coords = JSON.parse(localStorage.getItem('coords') || 'null');

  if (!coords && navigator.geolocation) {
    coords = await new Promise((res) =>
      navigator.geolocation.getCurrentPosition(
        (p) => res({ lat: +p.coords.latitude.toFixed(3), lon: +p.coords.longitude.toFixed(3) }),
        () => res(null),
        { timeout: 8000 }
      )
    );
    if (coords) localStorage.setItem('coords', JSON.stringify(coords));
  }
  if (!coords) {
    box.replaceChildren(el('p', { class: 'note' },
      'Location unavailable, so there is no forecast — and without one there is no ' +
      'honest outfit. Allow location and reload.'));
    return;
  }

  const q = new URLSearchParams({
    latitude: coords.lat, longitude: coords.lon,
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,weather_code',
    temperature_unit: 'fahrenheit', timezone: 'auto', forecast_days: 1,
  });
  try {
    const raw = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`).then((r) => r.json());
    state.forecast = readForecast(raw);
  } catch {
    // Per CHECKS.md: never guess a temperature. Say so and show nothing.
    box.replaceChildren(el('p', { class: 'note' },
      "Couldn't reach the forecast. Not guessing — no outfits until it's back."));
    return;
  }
  renderToday();
}

function meter(warmth, [lo, hi], max = 12) {
  return el('div', { class: 'meter', role: 'img',
    'aria-label': `warmth ${warmth} against a target of ${lo} to ${hi}` },
    Array.from({ length: max }, (_, i) => {
      const n = i + 1;
      const cls = n === warmth ? 'seg fill' : n >= lo && n <= hi ? 'seg band' : 'seg';
      return el('span', { class: cls });
    }));
}

function renderWeather() {
  const f = state.forecast;
  if (!f) return;
  $('#today-date').textContent = new Date(f.date + 'T12:00')
    .toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
    .toUpperCase();

  $('#weather').replaceChildren(
    el('div', { class: 'wx-top' },
      el('span', { class: 'temp' }, `${Math.round(f.high)}°`,
        el('span', { class: 'lo' }, ` / ${Math.round(f.low)}°`)),
      el('span', { class: 'cond' }, f.conditions[0].toUpperCase() + f.conditions.slice(1))),
    f.modifiers.length
      ? el('div', { class: 'chips' }, f.modifiers.map((m) => el('span', { class: 'chip' }, m)))
      : null,
    el('div', { class: 'target' },
      el('span', { class: 'label' }, 'Warmth'),
      meter(-1, f.target),
      el('span', { class: 'num' }, `${f.target[0]}–${f.target[1]}`)),
  );
}

// ---------------------------------------------------------------- today

function renderFormalityPicker() {
  $('#formality-picker').replaceChildren(
    ...FORMALITY.filter((f) => f.v >= 2 && f.v <= 4).map((f) =>
      el('span', {
        role: 'radio', tabindex: 0, title: f.hint,
        'aria-checked': String(f.v === state.formality),
        class: f.v === state.formality ? 'on' : '',
        onclick: () => { state.formality = f.v; localStorage.setItem('formality', f.v); renderToday(); },
      }, f.name))
  );
}

// A styled flat-lay rather than a row of thumbnails: pieces overlap on a single
// sweep the way clothes do when you lay them out, so it reads as an outfit
// instead of an inventory list.
function flatlay(pieces) {
  return el('div', { class: 'flatlay' },
    pieces
      .filter((p) => p.photo)
      .map((p) => el('img', {
        src: p.photo, alt: p.name, loading: 'lazy',
        class: `lay-${p.category}${p.cutout ? ' cut' : ''}`,
      })));
}

function outfitCard(outfit, note) {
  const { pieces, warmth } = outfit;
  return el('article', { class: 'card' },
    el('div', { class: 'card-head' },
      el('h2', { class: 'card-name' }, outfit.name || 'Today'),
      outfit.stretch ? el('span', { class: 'tag' }, 'Stretch') : null),
    flatlay(pieces),
    el('div', { class: 'pieces' }, pieces.map((p) => el('span', { class: 'piece-chip' }, p.name))),
    el('div', { class: 'warm-row' },
      el('span', { class: 'label' }, 'Warmth'),
      meter(warmth, state.forecast.target),
      el('span', { class: 'num' }, warmth)),
    note ? el('div', { class: 'rationale' },
      note.why ? el('div', { class: 'rationale-block' },
        el('span', { class: 'label' }, 'Why it works'), el('p', {}, note.why)) : null,
      note.how ? el('div', { class: 'rationale-block' },
        el('span', { class: 'label' }, 'How to wear it'), el('p', {}, note.how)) : null,
    ) : null,
    el('div', { class: 'card-foot' },
      el('button', { class: 'primary', onclick: () => wearThis(pieces) }, 'Wearing this'),
      el('button', { onclick: () => renderToday(true) }, 'Something else')),
  );
}

function wearThis(pieces) {
  cloud.logWear(state.uid, { date: todayISO(), item_ids: pieces.map((p) => p.id) });
  for (const p of pieces) {
    cloud.saveItem(state.uid, {
      id: p.id, wear_count: (p.wear_count || 0) + 1, last_worn: todayISO(),
    });
  }
}

function renderToday(reshuffle = false) {
  if (!state.uid) return;
  renderFormalityPicker();
  renderWeather();

  const out = $('#outfits');
  const gapBox = $('#gap');
  gapBox.replaceChildren();

  if (!state.forecast) return out.replaceChildren();

  if (!state.closet.length) {
    return out.replaceChildren(el('p', { class: 'note' },
      'Nothing in the closet yet. Add a few things and this fills in.'));
  }

  const ctx = {
    season: seasonOf(),
    formality: state.formality,
    recent: recentlyWorn(state.wearLog),
    forecast: state.forecast,
  };

  // Prefer outfits Claude composed on the Mac this morning; fall back to the
  // local rules engine so the app is never empty just because that didn't run.
  const byId = Object.fromEntries(state.closet.map((i) => [i.id, i]));
  let cards = [];
  if (state.composed?.outfits?.length && !reshuffle) {
    cards = state.composed.outfits
      .map((o) => {
        const pieces = (o.item_ids || []).map((id) => byId[id]).filter(Boolean);
        if (pieces.length < 2) return null;
        return outfitCard(
          { pieces, warmth: pieces.reduce((a, p) => a + (p.warmth || 0), 0), name: o.name, stretch: o.stretch },
          { why: o.why_it_works, how: o.styling_notes });
      })
      .filter(Boolean);
  }
  if (!cards.length) {
    const built = buildOutfits(state.closet, ctx, reshuffle ? 6 : 3);
    const picked = reshuffle ? built.slice(3) : built;
    cards = (picked.length ? picked : built).map((o) => outfitCard(o, null));
  }

  if (!cards.length) {
    const unrated = state.closet.filter((i) => i.fits_now == null || !i.comfort).length;
    out.replaceChildren(el('p', { class: 'note' }, unrated
      ? `Nothing to suggest yet — ${unrated} item${unrated > 1 ? 's' : ''} still need a fit and comfort rating.`
      : "Nothing in the closet works for today's weather at this dress level."));
  } else {
    out.replaceChildren(...cards);
  }

  const gap = biggestGap(state.closet, ctx);
  if (gap) {
    gapBox.replaceChildren(el('div', { class: 'gap' },
      el('span', { class: 'label' }, 'The one gap worth closing'),
      el('p', {}, `You have no ${gap.slot}. Adding one would unlock `,
        el('span', { class: 'count' }, gap.unlocks),
        ` combination${gap.unlocks > 1 ? 's' : ''} you already own the rest of.`)));
  }
}

// ---------------------------------------------------------------- closet

function renderCloset() {
  $('#closet-count').textContent = `${state.closet.length} ITEM${state.closet.length === 1 ? '' : 'S'}`;
  const needs = state.closet.filter((i) => i.fits_now == null || !i.comfort);
  const todo = $('#closet-todo');
  todo.hidden = !needs.length;
  todo.textContent = needs.length
    ? `${needs.length} item${needs.length > 1 ? 's' : ''} still need a fit and comfort rating before they can be used.`
    : '';

  $('#closet-grid').replaceChildren(...state.closet.map((item) => {
    const unrated = item.fits_now == null || !item.comfort;
    const cls = ['tile', unrated ? 'needs' : '', item.fits_now === false ? 'packed' : ''].filter(Boolean).join(' ');
    return el('button', { class: cls, onclick: () => editItem(item) },
      item.photo ? el('img', { src: item.photo, alt: item.name, loading: 'lazy' }) : null,
      el('figcaption', {},
        el('span', { class: 'nm' }, item.name),
        el('span', { class: 'st' },
          unrated ? 'NEEDS RATING' : item.fits_now === false ? 'PACKED AWAY' : `WORN ${item.wear_count || 0}×`)));
  }));
}

// ---------------------------------------------------------------- add

// Adding a wardrobe one garment at a time, answering a form each time, is how
// you end up never finishing. So: many files at once, everything the browser
// can work out filled in already, one set of answers applied to the whole
// batch, and per-item detail only when you go looking for it.

function selectField(labelText, key, options, current, onChange) {
  const sel = el('select', { onchange: (e) => onChange(key, coerce(e.target.value)) },
    ...options.map((o) => {
      const v = typeof o === 'object' ? o.v : o;
      const t = typeof o === 'object' ? o.name : o;
      return el('option', { value: v, selected: String(v) === String(current) }, t);
    }));
  return el('label', { class: 'field' }, el('span', { class: 'label' }, labelText), sel);
}
const coerce = (v) => (v === 'true' ? true : v === 'false' ? false : /^-?\d+$/.test(v) ? Number(v) : v);

function blankDraft(over = {}) {
  return {
    id: '', name: '', photo: null, category: 'top', subcategory: '',
    color_primary: '', color_secondary: null, color_family: 'neutral', value: 'mid',
    saturation: 'muted', fabric: '', texture: 'smooth', pattern: 'solid',
    structure: 2, silhouette: 'relaxed', length: 'hip', rise: 'n/a', leg: 'n/a',
    warmth: 2, formality_min: 2, formality_max: 3,
    seasons: ['spring', 'fall', 'winter'], water_ok: false,
    fits_now: null, comfort: null, wear_count: 0, last_worn: null,
    uncertain_fields: [], notes: '', cutout: false, cutoutReason: '',
    ...over,
  };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    // NB: img.decode() hangs indefinitely on a detached image in Chrome and
    // wedges the whole renderer. onload is the reliable path — don't "improve"
    // this back to decode().
    img.onerror = () => reject(new Error('unsupported'));
    img.src = src;
  });
}

// Resize, lift the backdrop, and read the colour off what survives.
async function processImage(src, max = 420) {
  const img = await loadImage(src);
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = el('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const draw = () => { ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height); };

  draw();
  let cut = { ok: false, reason: 'unreadable' };
  let colour = { value: 'mid', saturation: 'muted', color_family: 'neutral' };
  try {
    const pixels = ctx.getImageData(0, 0, c.width, c.height);
    cut = removeBackground(pixels);
    if (cut.ok) ctx.putImageData(pixels, 0, 0);
    else draw();
    colour = describeColour(cut.ok ? pixels : ctx.getImageData(0, 0, c.width, c.height));
  } catch {
    draw();
  }
  return {
    photo: cut.ok ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.72),
    cutout: cut.ok,
    cutoutReason: cut.reason || '',
    ...colour,
  };
}

async function prepare(file, max = 420) {
  const url = URL.createObjectURL(file);
  try {
    return await processImage(url, max);
  } catch {
    // Safari and iOS decode HEIC natively; Chrome and Firefox do not, and there
    // is no way to fix that client-side without shipping a decoder.
    throw new Error(/hei[cf]/i.test(file.type + file.name)
      ? `${file.name} is HEIC, which this browser can't open. Safari and iOS can — ` +
        `or set iPhone Camera to "Most Compatible" to shoot JPEG.`
      : `${file.name} didn't open as an image.`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const CUTOUT_NOTE = {
  'too-similar': 'too close in colour to what it was lying on',
  textured: 'background too busy to lift',
  'nothing-to-remove': 'no clear background',
  'ate-the-garment': 'too close in colour to its background',
  unreadable: "couldn't read the pixels",
};

// A filename is a weak guess but a free one, and it beats an empty field.
function guessName(filename) {
  const stem = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return /^(img|dsc|photo|screenshot|image)\b/i.test(stem) || /^\d+$/.test(stem) ? '' : stem;
}

async function ingest(files) {
  const note = $('#add-photo-note');
  const errors = [];
  note.hidden = false;
  note.textContent = `Reading ${files.length} image${files.length > 1 ? 's' : ''}…`;

  for (const file of files) {
    try {
      const prepared = await prepare(file);
      enqueue({ ...prepared, name: guessName(file.name) });
    } catch (e) {
      errors.push(e.message);
    }
    note.textContent = `Read ${state.queue.length} of ${files.length}…`;
  }

  const lifted = state.queue.filter((d) => d.cutout).length;
  note.textContent = [
    `${state.queue.length} ready, ${lifted} with the background lifted.`,
    errors.length ? errors.join(' ') : '',
  ].filter(Boolean).join(' ');
  renderQueue();
}

// Every draft enters the queue already carrying the batch answers. She changes
// them once at the top if the defaults are wrong, and taps individual items for
// the exceptions.
function enqueue(over) {
  state.queue.push(blankDraft({ ...state.bulk, ...over }));
}

function applyBulk(key, value) {
  state.bulk[key] = value;
  for (const d of state.queue) if (!d.touched) d[key] = value;
  renderQueue();
}

function renderQueue() {
  const wrap = $('#add-queue');
  const bulk = $('#add-bulk');
  const hasQueue = state.queue.length > 0;
  $('#drop').hidden = false;
  bulk.hidden = !hasQueue;
  $('#add-actions').hidden = !hasQueue;
  if (!hasQueue) { wrap.replaceChildren(); return; }

  // One set of answers for the whole batch. She said she doesn't keep clothes
  // that look bad on her, so "fits now" defaults to yes and she flags the
  // exceptions — which is a visible default, not a silent guess.
  bulk.replaceChildren(
    el('p', {}, `Set these once for all ${state.queue.length}, then tap any item that differs.`),
    el('div', { class: 'ask' },
      el('span', { class: 'label' }, 'These fit me right now'),
      el('div', { class: 'seg-ctl' }, FIT.map((f) =>
        el('span', {
          role: 'radio', tabindex: 0, 'aria-checked': String(state.bulk.fits_now === f.v),
          class: state.bulk.fits_now === f.v ? 'on' : '',
          onclick: () => applyBulk('fits_now', f.v),
        }, f.name)))),
    el('div', { class: 'ask' },
      el('span', { class: 'label' }, 'Comfort'),
      el('div', { class: 'seg-ctl' }, COMFORT.map((c) =>
        el('span', {
          role: 'radio', tabindex: 0, 'aria-checked': String(state.bulk.comfort === c.v),
          class: state.bulk.comfort === c.v ? 'on' : '',
          onclick: () => applyBulk('comfort', c.v),
        }, c.name)))),
  );

  wrap.replaceChildren(...state.queue.map((d, i) => {
    const open = state.expanded === i;
    const problems = [!d.name && 'needs a name', d.fits_now == null && 'needs fit',
                      !d.comfort && 'needs comfort'].filter(Boolean);
    return el('div', { class: `qitem${open ? ' open' : ''}${problems.length ? ' needs' : ''}` },
      el('button', { class: 'qhead', onclick: () => { state.expanded = open ? null : i; renderQueue(); } },
        el('img', { src: d.photo, alt: '' }),
        el('span', { class: 'qmeta' },
          el('span', { class: 'nm' }, d.name || 'Untitled'),
          el('span', { class: 'st' },
            [d.category, d.cutout ? 'cut out' : CUTOUT_NOTE[d.cutoutReason] || 'as-is',
             ...problems].join(' · '))),
        el('span', { class: 'chev' }, open ? '–' : '+')),
      open ? el('div', { class: 'qbody' },
        el('label', { class: 'field-in' }, el('span', { class: 'label' }, 'Name'),
          el('input', { type: 'text', value: d.name, placeholder: 'black pleated trousers',
            oninput: (e) => { d.name = e.target.value; d.touched = true; } })),
        el('div', { class: 'fields' },
          ...[['Category', 'category', CATEGORY], ['Warmth', 'warmth', [0, 1, 2, 3, 4, 5]],
              ['Dresses down to', 'formality_min', [1, 2, 3, 4, 5]],
              ['Dresses up to', 'formality_max', [1, 2, 3, 4, 5]],
              ['Colour family', 'color_family', COLOR_FAMILY], ['Lightness', 'value', VALUE],
              ['Texture', 'texture', TEXTURE], ['Pattern', 'pattern', PATTERN],
              ['Silhouette', 'silhouette', SILHOUETTE], ['Saturation', 'saturation', SATURATION],
              ['Survives rain', 'water_ok', [{ v: false, name: 'No' }, { v: true, name: 'Yes' }]],
             ].map(([lbl, key, opts]) =>
            selectField(lbl, key, opts, d[key], (k, v) => { d[k] = v; d.touched = true; })),
          el('label', { class: 'field' }, el('span', { class: 'label' }, 'Seasons'),
            el('div', { class: 'seg-ctl' }, SEASONS.map((s) =>
              el('span', {
                role: 'checkbox', tabindex: 0, 'aria-checked': String(d.seasons.includes(s)),
                class: d.seasons.includes(s) ? 'on' : '',
                onclick: (e) => {
                  const at = d.seasons.indexOf(s);
                  at < 0 ? d.seasons.push(s) : d.seasons.splice(at, 1);
                  d.touched = true;
                  e.target.classList.toggle('on');
                },
              }, s.slice(0, 3)))))),
        el('div', { class: 'ask' }, el('span', { class: 'label' }, 'Fits right now'),
          el('div', { class: 'seg-ctl' }, FIT.map((f) =>
            el('span', { role: 'radio', tabindex: 0, class: d.fits_now === f.v ? 'on' : '',
              onclick: () => { d.fits_now = f.v; d.touched = true; renderQueue(); } }, f.name)))),
        el('div', { class: 'ask' }, el('span', { class: 'label' }, 'Comfort'),
          el('div', { class: 'seg-ctl' }, COMFORT.map((c) =>
            el('span', { role: 'radio', tabindex: 0, class: d.comfort === c.v ? 'on' : '',
              onclick: () => { d.comfort = c.v; d.touched = true; renderQueue(); } }, c.name)))),
        el('button', { onclick: () => { state.queue.splice(i, 1); state.expanded = null; renderQueue(); } },
          'Remove'),
      ) : null);
  }));

  const ready = state.queue.filter((d) => d.name && d.fits_now != null && d.comfort).length;
  $('#add-save').textContent = `Save ${ready} to closet`;
  $('#add-save').disabled = ready === 0;
  $('#add-summary').textContent = ready < state.queue.length
    ? `${state.queue.length - ready} still need a name, a fit or a comfort rating.`
    : '';
}

function saveQueue() {
  const ready = state.queue.filter((d) => d.name && d.fits_now != null && d.comfort);
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const writes = ready.map((d) => {
    const item = { ...d, id: d.id || `${d.category}-${slug(d.name)}`,
                   formality_range: [d.formality_min, d.formality_max] };
    delete item.formality_min; delete item.formality_max;
    delete item.touched; delete item.cutoutReason;
    return cloud.saveItem(state.uid, item);
  });
  Promise.all(writes)
    .then(() => {
      state.queue = state.queue.filter((d) => !ready.includes(d));
      state.expanded = null;
      $('#add-photo-note').hidden = true;
      renderQueue();
      if (!state.queue.length) show('closet');
    })
    .catch((e) => {
      const err = $('#add-error');
      err.hidden = false;
      err.textContent = e.code === 'permission-denied'
        ? 'Firestore refused the write — check the security rules are published.'
        : e.message;
    });
}

// Bulk import of a seed file built by scripts/seed.py. Same queue, so the same
// one-set-of-answers step applies.
function importSeed(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    const note = $('#add-photo-note');
    try {
      const parsed = JSON.parse(reader.result);
      const items = parsed.items || parsed;
      if (!Array.isArray(items)) throw new Error('no items array');
      note.hidden = false;
      show('add');

      // The seed carries plain photographs. Run every one through the same
      // cutout the picker uses, so the flat-lay gets lifted garments rather
      // than a stack of bedsheet rectangles — and so the "cut out" label on
      // each tile is true rather than assumed.
      let lifted = 0;
      for (const [i, it] of items.entries()) {
        note.textContent = `Lifting backgrounds… ${i + 1} of ${items.length}`;
        const [lo, hi] = it.formality_range || [2, 3];
        const { fits_now, comfort, photo, ...rest } = it;
        let processed = { photo, cutout: false, cutoutReason: 'unreadable' };
        try {
          if (photo) processed = await processImage(photo);
        } catch { /* keep the original photo */ }
        if (processed.cutout) lifted++;
        enqueue({
          ...rest, ...processed, formality_min: lo, formality_max: hi,
          ...(fits_now == null ? {} : { fits_now }),
          ...(comfort == null ? {} : { comfort }),
        });
        if (i % 6 === 0) renderQueue();
      }
      note.textContent =
        `${items.length} items from ${file.name}. ${lifted} backgrounds lifted, ` +
        `${items.length - lifted} kept as photographed.`;
      renderQueue();
    } catch (e) {
      const err = $('#add-error');
      err.hidden = false;
      err.textContent = `Couldn't read that seed file: ${e.message}`;
    }
  };
  reader.readAsText(file);
}

function editItem(item) {
  const [lo, hi] = item.formality_range || [2, 3];
  state.queue = [blankDraft({ ...item, formality_min: lo, formality_max: hi, touched: true })];
  state.expanded = 0;
  $('#add-photo-note').hidden = true;
  show('add');
  renderQueue();
}

function wireAdd() {
  $('#drop').addEventListener('click', () => $('#add-file').click());
  $('#add-file').addEventListener('change', (ev) => {
    const files = [...(ev.target.files || [])];
    ev.target.value = '';
    if (files.length) ingest(files);
  });
  $('#import-file').addEventListener('change', (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (file) importSeed(file);
  });
  $('#closet-import').addEventListener('click', () => $('#import-file').click());
  $('#add-save').addEventListener('click', saveQueue);
  $('#add-clear').addEventListener('click', () => {
    state.queue = []; state.expanded = null;
    $('#add-photo-note').hidden = true; renderQueue();
  });
}

// ---------------------------------------------------------------- boot

$$('#nav button[data-view]').forEach((b) =>
  b.addEventListener('click', () => {
    show(b.dataset.view);
    if (b.dataset.view === 'add') renderQueue();
  }));

wireAuth();
wireAdd();
cloud.watchAuth(onUser);
if (!cloud.isConfigured) show('auth');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js'));
}
