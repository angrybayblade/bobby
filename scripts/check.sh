#!/bin/sh
# Project check (run from the project root, or from a snapshot of it): typecheck TS, syntax-check browser modules.
set -e
if ls src/*.ts >/dev/null 2>&1; then bunx tsc --noEmit; fi
for f in $(find public -name '*.js' 2>/dev/null); do node --check "$f"; done
