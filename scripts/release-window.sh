#!/usr/bin/env bash
# Decides whether a production release window (12:00, 15:00, 18:00, 00:00 IST)
# has anything to release. Writes deploy=true|false to $GITHUB_OUTPUT.
#   - A manual run (Run workflow) always releases.
#   - Scheduled runs start on $SCHEDULE_STARTS (IST date, YYYY-MM-DD).
#   - Nothing new on main since the commit Pulse-II serves: skip.
#   - Only documentation (docs/**, top-level *.md) changed since then: skip.
# Inputs: GITHUB_EVENT_NAME, RELEASE_COMMIT, SCHEDULE_STARTS, GITHUB_OUTPUT.
# For tests: RELEASE_WINDOW_TODAY replaces today's IST date and
# RELEASE_WINDOW_HEALTH_FILE replaces the live health check with a file.
set -uo pipefail

decide() { echo "deploy=$1" >> "$GITHUB_OUTPUT"; echo "Deploy this window: $1"; exit 0; }

if [[ "${GITHUB_EVENT_NAME:-}" != "schedule" ]]; then decide true; fi

TODAY_IST="${RELEASE_WINDOW_TODAY:-$(TZ=Asia/Kolkata date +%F)}"
if [[ -n "${SCHEDULE_STARTS:-}" && "$TODAY_IST" < "$SCHEDULE_STARTS" ]]; then
  echo "Scheduled releases start on ${SCHEDULE_STARTS} IST (today is ${TODAY_IST})."
  decide false
fi

HEALTH="${RELEASE_WINDOW_HEALTH_FILE:-}"
if [[ -z "$HEALTH" ]]; then
  HEALTH="${RUNNER_TEMP:-/tmp}/release-window-health.json"
  curl --fail --silent --max-time 15 https://pulse-ll.cmll.in/api/health -o "$HEALTH" || rm -f "$HEALTH"
fi
LIVE=''
if [[ -f "$HEALTH" ]]; then
  LIVE="$(node -e "const h=require(require('path').resolve(process.argv[1]));if(/^[0-9a-f]{40}$/.test(h.commit||''))process.stdout.write(h.commit)" "$HEALTH" 2>/dev/null || true)"
fi
echo "Pulse-II serves ${LIVE:-an unknown commit}; main is ${RELEASE_COMMIT}."

if [[ "$LIVE" == "$RELEASE_COMMIT" ]]; then
  echo "Nothing new on main since the last release."
  decide false
fi

# Unknown live commit: release, so production never stays behind main.
if [[ ! "$LIVE" =~ ^[0-9a-f]{40}$ ]]; then decide true; fi
git cat-file -e "${LIVE}^{commit}" 2>/dev/null || git fetch --quiet --depth=50 origin "$LIVE" 2>/dev/null || true
if ! git cat-file -e "${LIVE}^{commit}" 2>/dev/null || ! git merge-base --is-ancestor "$LIVE" "$RELEASE_COMMIT" 2>/dev/null; then
  decide true
fi

CHANGED="$(git diff --name-only "$LIVE" "$RELEASE_COMMIT")"
echo "Files changed since the last release:"
echo "${CHANGED:-(none)}"
if [[ -z "$CHANGED" ]] || ! grep -qvE '^docs/|^[^/]+\.md$' <<< "$CHANGED"; then
  echo "Only documentation changed; nothing to release."
  decide false
fi
decide true
