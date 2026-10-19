#!/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/frontend" && npm run build
cd "$ROOT/dashboard" && npm run build
rm -rf "$ROOT/worker/public"
mkdir -p "$ROOT/worker/public/dashboard"
cp -r "$ROOT/frontend/dist/." "$ROOT/worker/public/"
cp -r "$ROOT/dashboard/dist/." "$ROOT/worker/public/dashboard/"
cd "$ROOT/worker" && npx wrangler deploy
