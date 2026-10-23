#!/usr/bin/env bash
# One-command verification: unit/integration tests, production build, optional browser E2E.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== server tests";  (cd server && npm test)
echo "== client tests";  (cd client && npm test)
echo "== production build"
if [ -d client/node_modules/vite ]; then (cd client && npm run build); else (cd client && node scripts/build-esbuild.mjs); fi
test -f client/dist/index.html
echo "== OK (run 'npm run test:e2e' against a running server for the browser suite)"
