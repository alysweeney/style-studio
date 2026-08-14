# Style Studio

Translating Pinterest aesthetics into outfits from the closet Aly actually owns.

## The problem this solves

The boards are full of outfits she likes. The closet is full of clothes she owns.
Nothing connects them, so the default is six oversized tees and leggings on repeat,
plus purchases that don't fix it because they're bought against a vibe rather than
against a gap.

The bet: the missing piece isn't taste or clothes, it's a **shared vocabulary**. Pins
describe proportion, texture, and styling moves. Closets describe objects. Once both
are tagged in the same language (`taxonomy.md`), "your pins want X, your closet has Y"
becomes something a computer can say out loud.

## Status

| Piece | State |
|---|---|
| `taxonomy.md` — the shared vocabulary | drafted, **needs Aly's approval** |
| `CHECKS.md` — pre-commitments | drafted |
| `scripts/weather.py` — Open-Meteo + warmth model | **working, verified against live data** |
| `scripts/catalog.py` — photo → tagged item | written, untested (needs photos) |
| `scripts/outfit.py` — rules + Claude compose | written, untested (needs a catalog) |
| `data/style-dna.md` — the Pinterest distillation | **not started — needs the boards** |
| App | static mockup for approval, then a PWA |

## Architecture

```
Pinterest boards ──(Chrome, logged in)──> pins ──(vision)──> data/style-dna.md
                                                                     │
closet photos ──(vision + human review)──> data/closet.json          │
                                                    │                │
                             Open-Meteo ──> weather │                │
                                                    ▼                ▼
                                          rules filter ───> Claude composes
                                        (warmth, fit, laundry,   (which combo
                                         formality, recency)   looks like her)
                                                                     │
                                                                     ▼
                                                            outfits + reasoning
```

**Why the work is split that way.** The rules handle everything with a right answer:
layer arithmetic, what she wore yesterday, what doesn't fit. Claude handles the part
with no right answer: which combination reads like her boards, and why. Handing the
arithmetic to a model is how you get an outfit that's wrong about the weather; handing
the taste to a rules engine is how you get outfits that are technically correct and
look like nothing.

## Firebase setup

This app needs **its own Firebase project** — not the couch-to-novel or workout-tracker
one. Sharing would mean editing live security rules that protect other people's data
every time this app's schema changes.

**1. Create the project.** [console.firebase.google.com](https://console.firebase.google.com)
→ *Add project* → name it `style-studio`. Google Analytics is not needed; turn it off.

**2. Turn on sign-in.** *Build → Authentication → Get started →* enable
**Email/Password**. Nothing else.

**3. Create the database.** *Build → Firestore Database → Create database.* Start in
**production mode** (the rules below replace the default), and pick the region closest
to you — it can't be changed later.

**4. Get the web config.** *Project settings* (gear icon) *→ Your apps →* the `</>`
web icon → register the app, nickname `style-studio`. Copy the `firebaseConfig` object
and paste it over the `REPLACE_` placeholders in **`cloud.js`**.

That key is safe to commit. It identifies the project; it does not grant access. Access
is enforced entirely by the rules in step 5. (This is *not* true of an Anthropic key —
see the warning at the top of `cloud.js`.)

**5. Paste the security rules.** *Firestore Database → Rules*, replace everything:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/closet/{itemId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    match /users/{userId}/wearLog/{entryId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    match /users/{userId}/outfits/{date} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

Every path is scoped to one signed-in user reading and writing only their own documents.
Publish, then create your account from the app's sign-in screen.

**No Firebase Storage.** Garment photos are resized to ~400px in the browser and stored
as JPEG data URIs *inside* each closet document. Storage now requires the paid Blaze
plan for new projects, and a 20 KB thumbnail sits well under Firestore's 1 MiB
per-document cap — a hundred-item closet is roughly 2 MB in total.

### What lives where

| Collection | Written by | Holds |
|---|---|---|
| `users/{uid}/closet/{itemId}` | the app | every garment, its tags, its thumbnail |
| `users/{uid}/wearLog/{date}` | the app | what was actually worn |
| `users/{uid}/outfits/{date}` | `scripts/outfit.py` on the Mac | the day's composed outfits and reasoning |

## Setup (the Python side)

Only needed for Claude-composed outfits; the app runs without it.

```sh
python3 -m pip install --user anthropic
mkdir -p ~/.config/personal-automation
echo 'ANTHROPIC_API_KEY=sk-ant-...' > ~/.config/personal-automation/anthropic.env
```

The key lives outside this repo on purpose — repo convention, and doubly so now the
repo is public.

## The morning job

Composes the day's outfits on the Mac and leaves them in Firestore for the phone
to read. The phone handles weather and the rules on its own; what it can't do is
call Claude, because an Anthropic key is a bearer credential and would be
readable by anyone who viewed source.

```sh
python3 scripts/morning.py                 # dry run — prints, writes nothing
python3 scripts/morning.py --apply         # writes users/{uid}/outfits/{today}
python3 scripts/morning.py --formality 4   # dressing up
```

Credentials go in `~/.config/personal-automation/style-studio.env`:

```
STYLE_STUDIO_EMAIL=you@example.com
STYLE_STUDIO_PASSWORD=...
ANTHROPIC_API_KEY=sk-ant-...
```

`chmod 600` it. That's the same email and password you sign into the app with —
**not** a service account. A service account would be a second credential to
rotate and would bypass the security rules entirely, so a bug in a script could
write anywhere in the database. Signing in as yourself means every read and write
here obeys exactly the rules above, scoped to your own uid.

It refuses to write if Claude references an item id you don't own — an invented
garment is a bug, not a suggestion.

### Scheduling it

`scripts/com.alysweeney.style-studio.morning.plist` runs it at 06:40 daily. It is
**not installed** — repo convention is that anything writing somewhere
consequential earns an unattended slot only after a few reviewed dry runs.

```sh
cp scripts/com.alysweeney.style-studio.morning.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.alysweeney.style-studio.morning.plist
```

If the Mac is asleep at 06:40, launchd runs the job when it next wakes. The app
degrades gracefully either way: with nothing waiting, it falls back to the local
rules engine and shows outfits without the reasoning.

## Tests

```sh
./test/run.sh
```

36 checks against the rules engine: warmth bands and their boundaries, forecast
modifiers, every branch of the wearability filter, formality ranges, outfit assembly,
the outfit-level comfort rule, degenerate closets, and the gap list. Needs no install —
JavaScriptCore ships with macOS.

## Use

```sh
python3 scripts/weather.py                   # today's forecast + warmth target
python3 scripts/catalog.py                   # tag new photos (dry run, writes nothing)
python3 scripts/catalog.py --apply           # ...and save
python3 scripts/outfit.py                    # today's outfits
python3 scripts/outfit.py --formality 4      # dinner
python3 scripts/outfit.py --dry-run          # candidates only, no API call
```

Drop closet photos or listing screenshots in `photos/closet/`. After cataloging,
set `fit_status` and `comfort` by hand — a photo can't show whether something fits or
whether she'll keep it on all day, and the engine skips anything where those are unset.

## Cost

Roughly a cent a day for outfit generation. Cataloging is a one-time cost of a few
cents per photo. Weather is free and needs no key.

## The app: same stack as couch-to-novel

Not inventing a third pattern. `~/couch-to-novel` already solved "personal web app I
can open on my phone," so this reuses it wholesale:

- **Plain HTML/CSS/JS, no build step.** Which is just as well — there's no Node here.
- **PWA** via `manifest.json` + `service-worker.js` + 192/512 icons, installed with
  Add to Home Screen. The service worker is worth copying almost verbatim, including
  the network-first strategy and `cache: 'reload'` — that flag exists because GitHub
  Pages serves with `max-age=600`, so without it a deploy takes ten minutes to reach
  the phone and you end up debugging code that isn't running any more.
- **Hosted on GitHub Pages** from the repo root on `main`. Free, HTTPS, no CLI needed.
- **Firebase Auth + Firestore** free tier for data and cross-device sync, with offline
  persistence so logging an outfit with no signal works immediately and syncs later.
  **Its own Firebase project** — couch-to-novel's README is explicit that sharing one
  with workout-tracker would mean editing live security rules protecting other people's
  data every time this schema changes.
- **Tests run on JavaScriptCore**, which ships with macOS. No install, no Node.
- **Local dev** is `python3 -m http.server 8000`.
- **Structure separated from content**, the way `beats.js` / `curriculum.js` are split
  there — here the taxonomy and warmth bands become data files that `app.js` never
  hardcodes.

### The one place the pattern doesn't transfer

**A Firebase web API key is safe in client code; an Anthropic API key is not.**
Firebase's key is a project identifier, with access enforced by Firestore security
rules. An Anthropic key is a bearer credential — anyone who views source can spend
against it. So the Claude call cannot live in the phone app.

The split that follows:

| Runs where | What |
|---|---|
| Phone, client-side | Weather (Open-Meteo is CORS-friendly and keyless), the rules filter, wear logging |
| Aly's Mac, scheduled | `outfit.py` — the Claude call — writing the day's outfits to Firestore |
| Phone, reading | Today's composed outfits, synced down |

So the Mac does the thinking each morning and Firestore is the delivery mechanism.
The app degrades gracefully: if no composed outfits are waiting, it can still assemble
a weather-appropriate outfit from the rules alone, just without the reasoning.

The alternative is a Cloud Function proxying the API call, which keeps the key
server-side and works with the Mac asleep — but Firebase Functions needs the pay-as-you-go
Blaze plan. Worth doing only if the morning-job version proves annoying.

## Other decisions worth remembering

- **Artifacts can't be the app.** A published artifact can't make network calls, so it
  can't reach the weather API or Claude. Artifacts are for mockups only.
- **Pinterest can't be scraped.** The board HTML is a JS shell — a 1.2MB page yielded
  exactly one image URL, and the old RSS endpoint is dead. Their internal resource API
  returns 403 even with a valid CSRF token from a logged-in session, and hammering it
  degrades page rendering. Screenshots read visually are the reliable path.
