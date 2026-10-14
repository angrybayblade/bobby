#!/bin/sh
# Project check (run from the project root, or from a snapshot of it): typecheck TS, syntax-check browser modules, run the tests.
set -e
if ls src/*.ts >/dev/null 2>&1; then bunx tsc --noEmit; fi
for f in $(find public -name '*.js' 2>/dev/null); do node --check "$f"; done
if ls test/*.test.ts >/dev/null 2>&1; then
  out=$(bun test --bail 2>&1) || { echo "$out"; exit 1; }
  echo "$out" | tail -n 4
fi
