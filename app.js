// Render and wiring. All the interesting decisions live in outfits.js
// (the rules) and taxonomy.js (the vocabulary); this file only puts them on
// screen and takes input back.

import * as cloud from './cloud.js';
import { buildOutfits, readForecast, seasonOf, recentlyWorn, biggestGap, wearable } from './outfits.js';
import { removeBackground } from './cutout.js';
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
  draft: null,
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
      .map((p) => el('img', { src: p.photo, alt: p.name, class: `lay-${p.category}`, loading: 'lazy' })));
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

function editItem(item) {
  state.draft = { ...item };
  openAdd(item.photo, item.name);
}

// ---------------------------------------------------------------- add

function selectField(labelText, key, options, current) {
  const sel = el('select', { onchange: (e) => { state.draft[key] = coerce(e.target.value); } },
    ...options.map((o) => {
      const v = typeof o === 'object' ? o.v : o;
      const t = typeof o === 'object' ? o.name : o;
      return el('option', { value: v, selected: String(v) === String(current) }, t);
    }));
  return el('label', { class: 'field' }, el('span', { class: 'label' }, labelText), sel);
}
const coerce = (v) => (v === 'true' ? true : v === 'false' ? false : /^-?\d+$/.test(v) ? Number(v) : v);

function renderTagFields() {
  const d = state.draft;
  $('#f-tags').replaceChildren(
    selectField('Category', 'category', CATEGORY, d.category),
    selectField('Warmth', 'warmth', [0, 1, 2, 3, 4, 5], d.warmth),
    selectField('Dresses down to', 'formality_min', [1, 2, 3, 4, 5], d.formality_min),
    selectField('Dresses up to', 'formality_max', [1, 2, 3, 4, 5], d.formality_max),
    selectField('Colour family', 'color_family', COLOR_FAMILY, d.color_family),
    selectField('Lightness', 'value', VALUE, d.value),
    selectField('Texture', 'texture', TEXTURE, d.texture),
    selectField('Pattern', 'pattern', PATTERN, d.pattern),
    selectField('Silhouette', 'silhouette', SILHOUETTE, d.silhouette),
    selectField('Saturation', 'saturation', SATURATION, d.saturation),
    selectField('Survives rain', 'water_ok', [{ v: false, name: 'No' }, { v: true, name: 'Yes' }], d.water_ok),
    el('label', { class: 'field' }, el('span', { class: 'label' }, 'Seasons'),
      el('div', { class: 'seg-ctl' }, SEASONS.map((s) =>
        el('span', {
          role: 'checkbox', tabindex: 0,
          'aria-checked': String(d.seasons.includes(s)),
          class: d.seasons.includes(s) ? 'on' : '',
          onclick: (e) => {
            const i = d.seasons.indexOf(s);
            i < 0 ? d.seasons.push(s) : d.seasons.splice(i, 1);
            e.target.classList.toggle('on');
            e.target.setAttribute('aria-checked', String(i < 0));
          },
        }, s.slice(0, 3))))),
  );
}

function renderHumanFields() {
  const d = state.draft;
  $('#f-fits').replaceChildren(...FIT.map((f) =>
    el('span', {
      role: 'radio', tabindex: 0, 'aria-checked': String(d.fits_now === f.v),
      class: d.fits_now === f.v ? 'on' : '',
      onclick: () => { d.fits_now = f.v; renderHumanFields(); },
    }, f.name)));

  $('#f-comfort').replaceChildren(...COMFORT.map((c) =>
    el('span', {
      role: 'radio', tabindex: 0, 'aria-checked': String(d.comfort === c.v),
      class: d.comfort === c.v ? 'on' : '',
      onclick: () => { d.comfort = c.v; renderHumanFields(); },
    }, c.name)));

  const chosen = COMFORT.find((c) => c.v === d.comfort);
  $('#comfort-hint').textContent = chosen
    ? `“${chosen.hint}”. One low-comfort piece in an outfit is fine — a whole outfit of them isn't.`
    : 'One low-comfort piece in an outfit is fine — a whole outfit of them isn\'t.';
}

function blankDraft() {
  return {
    id: '', name: '', photo: null, category: 'top', warmth: 2,
    formality_min: 2, formality_max: 3, color_family: 'neutral', value: 'mid',
    texture: 'smooth', pattern: 'solid', silhouette: 'relaxed', saturation: 'muted',
    water_ok: false, seasons: ['spring', 'fall', 'winter'],
    fits_now: null, comfort: null, wear_count: 0, last_worn: null,
  };
}

function openAdd(photo = null, name = '') {
  if (!state.draft) state.draft = blankDraft();
  const d = state.draft;
  d.formality_min ??= (d.formality_range || [2, 3])[0];
  d.formality_max ??= (d.formality_range || [2, 3])[1];
  d.seasons ||= [];

  $('#add-preview').hidden = !photo;
  if (photo) $('#add-preview').src = photo;
  $('#drop-empty').hidden = !!photo;
  $('#f-name').value = name || d.name || '';
  $('#add-form').hidden = !photo;
  $('#add-error').hidden = true;
  renderTagFields();
  renderHumanFields();
  show('add');
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file didn't open as an image."));
    img.src = URL.createObjectURL(file);
  });
}

// Resize, then lift the backdrop so the piece can sit on the flat-lay sweep
// instead of inside its own rectangle.
//
// ~420px keeps the whole garment inside a Firestore document — well under the
// 1 MiB per-doc cap, which is what lets us skip Firebase Storage and its paid
// plan. A successful cutout has to be PNG to carry transparency; a refusal
// stays JPEG, which is smaller, and the original pixels are redrawn because
// removeBackground may have already zeroed alpha before deciding to give up.
async function prepare(file, max = 420) {
  const img = await loadImage(file);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = el('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const draw = () => { ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height); };

  draw();
  let result;
  try {
    const pixels = ctx.getImageData(0, 0, c.width, c.height);
    result = removeBackground(pixels);
    if (result.ok) ctx.putImageData(pixels, 0, 0);
    else draw();
  } catch {
    // getImageData can throw on a tainted canvas; not fatal, just no cutout.
    draw();
    result = { ok: false, reason: 'unreadable' };
  }
  URL.revokeObjectURL(img.src);

  return {
    photo: result.ok ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.72),
    cutout: result.ok,
    reason: result.reason,
  };
}

// The failure the algorithm cannot see: a model shot cuts out perfectly and is
// still useless, because what survives is a person. Only the preview can tell
// her that, so every message points back at it.
const CUTOUT_NOTE = {
  textured: 'Kept as-is — the background is too busy to lift cleanly. Lay it on a plain ' +
            'surface, or long-press the garment in Photos to lift the subject first.',
  'nothing-to-remove': 'Kept as-is — no clear background to lift.',
  'ate-the-garment': 'Kept as-is — the garment is too close in colour to its background ' +
                     'to separate them safely.',
  unreadable: "Kept as-is — couldn't read the image data.",
};

function wireAdd() {
  $('#drop').addEventListener('click', () => $('#add-file').click());
  $('#add-file').addEventListener('change', async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      const { photo, cutout, reason } = await prepare(file);
      state.draft ||= blankDraft();
      state.draft.photo = photo;
      openAdd(photo, state.draft.name);
      const note = $('#add-photo-note');
      note.hidden = false;
      note.textContent = cutout
        ? 'Background removed. Check the preview: if you can still see a model wearing ' +
          'it, use the flat product photo instead — lifting the backdrop off a person ' +
          'leaves the person, and that never sits right in a flat-lay.'
        : CUTOUT_NOTE[reason] || 'Kept as-is.';
    } catch (e) {
      $('#add-error').hidden = false;
      $('#add-error').textContent = e.message;
    }
  });

  $('#add-cancel').addEventListener('click', () => { state.draft = null; show('closet'); });

  $('#add-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const d = state.draft;
    const err = $('#add-error');
    d.name = $('#f-name').value.trim();

    if (!d.name) return fail('Give it a name you would actually say out loud.');
    if (d.fits_now == null) return fail('Does it fit you right now? That one is not optional.');
    if (!d.comfort) return fail('Pick a comfort level — the engine will not guess it.');
    if (!d.seasons.length) return fail('Pick at least one season.');
    if (d.formality_min > d.formality_max) return fail('It cannot dress down further than it dresses up.');

    const item = {
      ...d,
      id: d.id || `${d.category}-${d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.replace(/-+$/, ''),
      formality_range: [d.formality_min, d.formality_max],
    };
    delete item.formality_min;
    delete item.formality_max;

    cloud.saveItem(state.uid, item)
      .then(() => { state.draft = null; show('closet'); })
      .catch((e) => fail(e.code === 'permission-denied'
        ? 'Firestore refused the write — check the security rules are published.'
        : e.message));

    function fail(msg) { err.hidden = false; err.textContent = msg; }
  });
}

// ---------------------------------------------------------------- boot

$$('#nav button[data-view]').forEach((b) =>
  b.addEventListener('click', () => {
    if (b.dataset.view === 'add' && !state.draft) state.draft = blankDraft();
    if (b.dataset.view === 'add') openAdd(state.draft.photo, state.draft.name);
    else show(b.dataset.view);
  }));

wireAuth();
wireAdd();
cloud.watchAuth(onUser);
if (!cloud.isConfigured) show('auth');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js'));
}
