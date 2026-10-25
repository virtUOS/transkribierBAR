#!/usr/bin/env bash
# Start a built container image and check that it serves the API, the SPA and
# the public guide. Usage: scripts/smoke-test-image.sh <image>
# Uses docker, or podman when docker is missing (override with ENGINE=...).
set -euo pipefail

image=${1:?usage: $0 <image>}
engine=${ENGINE:-$(command -v docker >/dev/null && echo docker || echo podman)}
name=smoke-$$
port=${SMOKE_PORT:-18080}

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "--- container log ---"
    "$engine" logs "$name" 2>&1 | tail -50 || true
  fi
  "$engine" rm -f "$name" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

# DEV_MODE stands in for the auth proxy; the ASR/LLM hosts are never contacted.
"$engine" run -d --name "$name" -p "127.0.0.1:$port:8000" \
  -e DEV_MODE=true -e ASR_URL=http://127.0.0.1:9 -e LLM_PROVIDER= \
  "$image" >/dev/null

url="http://127.0.0.1:$port"
for _ in $(seq 60); do
  curl -fsS "$url/api/health" >/dev/null 2>&1 && break
  sleep 1
done

check() {
  local path=$1 pattern=$2 body
  body=$(curl -fsS "$url$path") || { echo "FAIL $path: request failed"; return 1; }
  grep -q -- "$pattern" <<<"$body" || { echo "FAIL $path: missing '$pattern'"; return 1; }
  echo "ok   $path"
}

# The guide is generated at build time with placeholders that the backend fills
# in per request (frontend/src/help/render/staticGuide.ts ↔ backend/app/public_pages.py).
check_filled() {
  local path=$1 body
  body=$(curl -fsS "$url$path") || { echo "FAIL $path: request failed"; return 1; }
  if grep -o -- '__TW_[A-Z_]*__\|<!--/\?tw-feature:[a-z_]*-->' <<<"$body" | sort -u | grep .; then
    echo "FAIL $path: placeholders left in the page"
    return 1
  fi
  echo "ok   $path (placeholders filled)"
}

check /api/health '"status"'
check /api/config '"asr_backend"'
check / '<div id="root">'
check /some/client/route '<div id="root">'
check /handbuch/ '<html'
check_filled /handbuch/
