#!/usr/bin/env bash
# Shared by scripts/release-window.sh (production release) and
# scripts/merge-and-release.sh: this run's GitHub identity, calls to Pulse-II's
# release APIs, and the wait for an Approve / Reject tap on Telegram.
# Needs BASE_URL (Pulse-II address) set by the caller.
BASE_URL="${BASE_URL:-${RELEASE_OTP_BASE_URL:-https://pulse-ll.cmll.in}}"

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

# A JSON object from key=value arguments; empty values are left out.
approval_body() {
  node -e "process.stdout.write(JSON.stringify(Object.fromEntries(process.argv.slice(1).map(a=>{const i=a.indexOf('=');return [a.slice(0,i),a.slice(i+1)]}).filter(([k,v])=>k&&v!==''))))" "$@"
}

# Waits for the Telegram answer to approval request $1. Prints the last status
# answer; succeeds only when it is "approved". RELEASE_APPROVAL_WAIT_SECONDS
# (default 660, a little over the 10-minute validity) and
# RELEASE_APPROVAL_POLL_SECONDS (default 10) are for tests.
wait_for_approval() {
  local id="$1" step="${RELEASE_APPROVAL_POLL_SECONDS:-10}" result status
  local deadline=$(( SECONDS + ${RELEASE_APPROVAL_WAIT_SECONDS:-660} ))
  while (( SECONDS <= deadline )); do
    if result="$(release_api "/api/release-approval/${id}/status" '{}')"; then
      status="$(field status <<< "$result")"
      if [[ -n "$status" && "$status" != pending ]]; then echo "$result"; [[ "$status" == approved ]]; return; fi
    fi
    sleep "$step"
  done
  echo '{"status":"expired"}'
  return 1
}

# "approved by Mohit Chadda" / "rejected by Anoop" / "expired" from a status answer.
approval_outcome() {
  local result="$1" status by
  status="$(field status <<< "$result")" by="$(field decidedBy <<< "$result")"
  echo "${status:-unanswered}${by:+ by ${by}}"
}
