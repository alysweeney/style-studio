#!/bin/sh
# Runs the rules engine against awkward inputs.
#
# Parsing only proves a file is syntactically valid. These actually execute the
# functions, so evaluation-order bugs, undefined variables and null property
# reads surface here rather than on the phone at 8am.
#
# Needs no install: JavaScriptCore ships with macOS.
cd "$(dirname "$0")/.."
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
[ -x "$JSC" ] || { echo "JavaScriptCore not found at $JSC"; exit 1; }

TMP=$(mktemp /tmp/style-engine-XXXXXX.js)
trap 'rm -f "$TMP"' EXIT

# jsc has no module loader here, so flatten: drop the import lines and the
# export keyword, then concatenate in dependency order.
strip() { sed -e "/^import .* from '.*';$/d" -e 's/^export //' "$1"; }

# jsc exits 0 even when the script dies on a SyntaxError — it prints the
# exception and reports success, so a broken test file would pass silently.
# (That is exactly how a duplicate `const` slipped through once.) Fail on any
# exception in the output as well as on a non-zero exit.
run() {
  out=$("$JSC" "$1" 2>&1); code=$?
  printf '%s\n' "$out"
  case "$out" in *Exception:*) exit 1 ;; esac
  [ "$code" -eq 0 ] || exit 1
}

{ strip taxonomy.js; strip outfits.js; cat test/engine.js; } > "$TMP"
run "$TMP"

# Background removal works on a plain {data,width,height} rather than a real
# ImageData precisely so it can be exercised here, with no canvas in sight.
CUT=$(mktemp /tmp/style-cutout-XXXXXX.js)
trap 'rm -f "$TMP" "$CUT"' EXIT
{ strip cutout.js; cat test/cutout.js; } > "$CUT"
run "$CUT"
