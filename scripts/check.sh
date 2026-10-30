#!/usr/bin/env bash
# Run the checks CI runs on a pull request. Usage, from anywhere in the repo:
#   scripts/check.sh            backend tests, frontend lint/typecheck/tests (about a minute)
#   scripts/check.sh --e2e      the above plus the end-to-end tests
#   scripts/check.sh --image    the above plus building and smoke-testing the container image
# The backend runs with $PYTHON, else the repo's .venv, else python3.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
python=${PYTHON:-$([ -x "$root/.venv/bin/python" ] && echo "$root/.venv/bin/python" || echo python3)}
e2e=false image=false
for arg in "$@"; do
  case $arg in
    --e2e) e2e=true ;;
    --image) e2e=true image=true ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

step "backend: pytest with coverage"
(cd "$root/backend" && LLM_API_KEY=${LLM_API_KEY:-dummy} "$python" -m pytest -q --cov)

step "frontend: lint"
(cd "$root/frontend" && npm run --silent lint)
step "frontend: type-check"
(cd "$root/frontend" && npm run --silent typecheck)
step "frontend: unit tests with coverage"
(cd "$root/frontend" && npm run --silent test:coverage)

if $e2e; then
  step "end-to-end tests"
  (cd "$root/frontend" && PYTHON=$python npm run --silent test:e2e)
fi

if $image; then
  engine=${ENGINE:-$(command -v docker >/dev/null && echo docker || echo podman)}
  step "container image: build and smoke test"
  "$engine" build -t localhost/transkribierbar:check "$root"
  ENGINE=$engine "$root/scripts/smoke-test-image.sh" localhost/transkribierbar:check
fi

step "all checks passed"
