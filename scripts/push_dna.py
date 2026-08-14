"""Upload data/style-dna.md to Firestore so the scheduled job can read it.

The style DNA describes Aly specifically — her palette, her proportions, the
gaps in her wardrobe. That doesn't belong in a public repo, so it's gitignored
and lives in Firestore with the rest of her data instead. This is how it gets
there.

  python3 scripts/push_dna.py            # dry run
  python3 scripts/push_dna.py --apply
"""

import argparse
import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import firestore
import lib
import morning

ap = argparse.ArgumentParser()
ap.add_argument("--apply", action="store_true")
args = ap.parse_args()

if not lib.STYLE_DNA.exists():
    raise SystemExit(f"Nothing to upload — {lib.STYLE_DNA} doesn't exist.")

text = lib.STYLE_DNA.read_text()
print(f"{lib.STYLE_DNA.name}: {len(text):,} characters, "
      f"{len(text.splitlines())} lines", file=sys.stderr)

if not args.apply:
    print("Dry run — nothing written. Re-run with --apply.", file=sys.stderr)
    raise SystemExit

email, password = morning.credentials()
db = firestore.Client(email, password)
db.put("style/dna", {"text": text,
                     "updated_at": dt.datetime.now().isoformat(timespec="seconds")})
print(f"Wrote users/{db.uid}/style/dna", file=sys.stderr)
