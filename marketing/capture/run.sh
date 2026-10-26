#!/bin/sh
# Re-captures the marketing mock from the real app: builds the demo PR, opens it in Bobby (this checkout's, or $BOBBY's),
# drives it through the story and writes ../bobby.js; also regenerates the GitHub page's diff in ../index.html.
# Nothing reaches GitHub: the token is a dud, avatars are initials and the Conversation timeline is the story's.
# usage: marketing/capture/run.sh [screenshots dir]      needs bun, node, python3 and Chrome ($CHROME)
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
BOBBY=${BOBBY:-$(cd "$HERE/../.." && pwd)}
PORT=${PORT:-4181}
TMP=$(mktemp -d)
trap 'kill $PID 2>/dev/null || true; rm -rf "$TMP"' EXIT
[ -d "$HERE/node_modules/puppeteer-core" ] || (cd "$HERE" && npm install --silent --no-audit --no-fund)

"$HERE/demo-repo.sh" "$TMP/payments" > /dev/null
python3 "$HERE/github-diff.py" "$TMP/payments" "$HERE/../index.html"

# a Bobby of its own: fresh state, the look the mock uses, no tour
mkdir -p "$TMP/home/.bobby" "$TMP/bin"
echo '{"tour":"seen","theme":"light","palette":"github","motion":"off","drift":"off","diffLayout":"inline","hints":"always","news":["palette","tour","inspect","uses","keys"],"claude":"never","gh":"never"}' > "$TMP/home/.bobby/settings.json"
cp "$HERE/fake-claude" "$TMP/bin/claude"; cp "$HERE/tree.json" "$TMP/bin/tree.json"
cd "$TMP/payments"
PATH="$TMP/bin:$PATH" HOME="$TMP/home" bun run "$BOBBY/src/cli.ts" extract --refresh > "$TMP/local.json" 2> "$TMP/extract.log"
python3 "$HERE/make-graph.py" "$TMP/local.json" "$TMP/pr.json"
HOME="$TMP/home" GH_TOKEN=invalid bun run "$BOBBY/src/cli.ts" open "$TMP/pr.json" --repo "$TMP/payments" --no-open --no-lsp --port "$PORT" > "$TMP/bobby.log" 2>&1 &
PID=$!
for i in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.5; done

cd "$HERE" && PAGE="$HERE/../index.html" node capture.mjs "http://127.0.0.1:$PORT/r/acme/payments/482" "$HERE/../bobby.js" "$@"
