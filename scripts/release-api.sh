#!/usr/bin/env bash
# Shared by scripts/release-window.sh (production release) and scripts/merge-and-release.sh:
# this run's GitHub identity and calls to Pulse-II's release APIs.
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
json_body() {
  node -e "process.stdout.write(JSON.stringify(Object.fromEntries(process.argv.slice(1).map(a=>{const i=a.indexOf('=');return [a.slice(0,i),a.slice(i+1)]}).filter(([k,v])=>k&&v!==''))))" "$@"
}
