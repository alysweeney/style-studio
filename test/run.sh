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

{ strip taxonomy.js; strip outfits.js; cat test/engine.js; } > "$TMP"
"$JSC" "$TMP" || exit 1
