#!/usr/bin/env bash
# Decides whether a production release window (12:00, 15:00, 18:00, 00:00 IST)
# has anything to release. Writes deploy=true|false to $GITHUB_OUTPUT.
#   - A manual run (Run workflow) asks RELEASE_WHEN:
#       "Next scheduled window": nothing to do now; says when it goes out.
#       "Urgent" without RELEASE_OTP: Pulse-II sends an OTP to the owner's
#         WhatsApp; run again with Urgent and that OTP.
#       "Urgent" with RELEASE_OTP: Pulse-II checks it; a match releases now.
#   - Scheduled runs start on $SCHEDULE_STARTS (IST date, YYYY-MM-DD).
#   - Nothing new on main since the commit Pulse-II serves: skip.
#   - Only documentation (docs/**, top-level *.md) changed since then: skip.
# Inputs: GITHUB_EVENT_NAME, RELEASE_COMMIT, SCHEDULE_STARTS, GITHUB_OUTPUT,
# RELEASE_WHEN, RELEASE_OTP, and GitHub's ACTIONS_ID_TOKEN_REQUEST_URL/TOKEN.
# For tests: RELEASE_WINDOW_TODAY replaces today's IST date,
# RELEASE_WINDOW_HEALTH_FILE replaces the live health check with a file,
# RELEASE_WINDOW_NOW_MS replaces the clock and RELEASE_OTP_BASE_URL the app address.
set -uo pipefail

decide() { echo "deploy=$1" >> "$GITHUB_OUTPUT"; echo "Deploy this window: $1"; exit 0; }
summary() { echo "$1"; echo "$1" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"; }
BASE_URL="${RELEASE_OTP_BASE_URL:-https://pulse-ll.cmll.in}"

next_window() {
  node -e "const now=Number(process.argv[1])||Date.now(),ist=new Date(now+330*60000),m=ist.getUTCHours()*60+ist.getUTCMinutes();
const w=[720,900,1080,1440].find(x=>x>m);process.stdout.write(w===1440?'00:00 IST tonight':String(w/60).padStart(2,'0')+':00 IST today')" "${RELEASE_WINDOW_NOW_MS:-}"
}

# This workflow run's GitHub OIDC identity, minted once in the main shell so the
# mask command reaches the runner log.
TOKEN=''
mint_identity() {
  [[ -n "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ]] || return 0
  TOKEN="$(curl --fail --silent --max-time 20 -H "Authorization: bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=pulse-ii-release" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(JSON.parse(s).value||'')}catch{}})")"
  [[ -z "$TOKEN" ]] || echo "::add-mask::${TOKEN}"
}
field() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const v=JSON.parse(s)[process.argv[1]];process.stdout.write(v==null?'':String(v))}catch{}})" "$1"; }
# POST to Pulse-II's release OTP API as this workflow run. A failure without a
# JSON reason (an HTML error page, no answer) is reported with its HTTP code.
release_api() {
  local path="$1" body="$2" response payload code
  if [[ -z "$TOKEN" ]]; then echo '{"error":"GitHub did not issue an identity for this run (id-token: write)."}'; return 1; fi
  response="$(curl --silent --max-time 30 -w '\n%{http_code}' -X POST -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' --data "$body" "${BASE_URL}${path}")"
  payload="${response%$'\n'*}" code="${response##*$'\n'}"
  if [[ "$code" == 200 ]]; then echo "$payload"; return 0; fi
  if [[ -n "$(field error <<< "$payload")" ]]; then echo "$payload"
  elif [[ "$code" == 000 ]]; then echo '{"error":"Pulse-II did not answer."}'
  elif [[ "$code" == 404 ]]; then echo '{"error":"Pulse-II answered HTTP 404: the release OTP service is not live there yet (it goes live with the next scheduled release)."}'
  else echo "{\"error\":\"Pulse-II answered HTTP ${code}.\"}"
  fi
  return 1
}

if [[ "${GITHUB_EVENT_NAME:-}" == "workflow_dispatch" ]]; then
  if [[ "${RELEASE_WHEN:-}" != Urgent* ]]; then
    summary "Not urgent: no deployment now. Everything merged to main goes out in the next scheduled window, $(next_window)."
    decide false
  fi
  OTP="$(tr -d '[:space:]' <<< "${RELEASE_OTP:-}")"
  if [[ -n "$OTP" ]]; then echo "::add-mask::${OTP}"; fi
  if [[ -n "$OTP" && ! "$OTP" =~ ^[0-9]{6}$ ]]; then summary "Urgent release: enter the six-digit OTP."; echo "::error::The OTP must be six digits."; exit 1; fi
  mint_identity
  if [[ -z "$OTP" ]]; then
    if result="$(release_api /api/release-otp/request '{}')"; then
      summary "Urgent release: an OTP was sent to the $(field recipient <<< "$result"). Get it from the owner, then Run workflow again with \"Urgent\" and the OTP within $(field expiresInMinutes <<< "$result") minutes. Nothing was deployed yet."
      decide false
    fi
    summary "Urgent release: the OTP could not be sent. $(field error <<< "$result")"
    echo "::error::The urgent release OTP could not be sent."
    exit 1
  fi
  if result="$(release_api /api/release-otp/verify "{\"otp\":\"${OTP}\"}")"; then
    summary "Urgent release approved by the owner's OTP. Releasing main now."
    decide true
  fi
  summary "Urgent release refused: $(field error <<< "$result")"
  echo "::error::The urgent release OTP was not accepted."
  exit 1
fi

if [[ "${GITHUB_EVENT_NAME:-}" != "schedule" ]]; then decide false; fi

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
