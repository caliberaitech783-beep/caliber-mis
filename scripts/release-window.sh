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

# mint_identity, field, release_api and json_body.
source "$(dirname "${BASH_SOURCE[0]}")/release-api.sh"

# A backup trigger (Run workflow with "Scheduled window") runs the same checks as
# GitHub's own timer, because GitHub can start timed runs hours late or not at all.
WINDOW_RUN=false
if [[ "${GITHUB_EVENT_NAME:-}" == "schedule" ]] || [[ "${GITHUB_EVENT_NAME:-}" == "workflow_dispatch" && "${RELEASE_WHEN:-}" == "Scheduled window"* ]]; then
  WINDOW_RUN=true
fi

if [[ "${GITHUB_EVENT_NAME:-}" == "workflow_dispatch" && "$WINDOW_RUN" != true ]]; then
  if [[ "${RELEASE_WHEN:-}" != Urgent* ]]; then
    summary "Not urgent: no deployment now. Everything merged to main goes out in the next scheduled window, $(next_window)."
    decide false
  fi
  OTP="$(tr -d '[:space:]' <<< "${RELEASE_OTP:-}")"
  if [[ -n "$OTP" ]]; then echo "::add-mask::${OTP}"; fi
  if [[ -n "$OTP" && ! "$OTP" =~ ^[0-9]{6}$ ]]; then summary "Urgent release: enter the six-digit OTP."; echo "::error::The OTP must be six digits."; exit 1; fi
  MERGE_APPROVAL="$(tr -d '[:space:]' <<< "${RELEASE_APPROVAL:-}")"
  if [[ -n "$MERGE_APPROVAL" && ! "$MERGE_APPROVAL" =~ ^[0-9a-f]{16}$ ]]; then summary "Urgent release: the approval reference is not valid."; echo "::error::Invalid approval reference."; exit 1; fi
  mint_identity
  # Started by "Merge a PR and make it live" (scripts/merge-and-release.sh) after a tap on Approve: the PR is
  # merged and this run spends that same approval, once.
  if [[ -n "$MERGE_APPROVAL" ]]; then
    if decision="$(release_api /api/release-otp/decision "{\"id\":\"${MERGE_APPROVAL}\"}")" && [[ "$(field status <<< "$decision")" == approved ]]; then
      PR_NUMBER="$(field prNumber <<< "$decision")"
      summary "Urgent release approved on Telegram by $(field by <<< "$decision")${PR_NUMBER:+ (PR #${PR_NUMBER} merged)}. Releasing main now."
      decide true
    fi
    summary "Urgent release refused: the Telegram approval is $(field status <<< "${decision:-}")$(field error <<< "${decision:-}"). Nothing was deployed."
    echo "::error::The merge approval was not accepted."
    exit 1
  fi
  # Approve / Reject on Telegram (owner's choice, 15 Nov 2026): the run sends the buttons to Mr Anoop and
  # Mr Mohit Chadda and waits for the first tap. Only when the buttons cannot be sent (the server does not
  # have them yet, or nobody has linked Telegram) does it fall back to the OTP below.
  if [[ -z "$OTP" ]]; then
    SUBJECT="$(git log -1 --format=%s "${RELEASE_COMMIT:-HEAD}" 2>/dev/null | head -c 200)"
    # Who asked and from where, shown in the Telegram message (Run workflow fields; GitHub cannot tell).
    BODY="$(json_body commit="${RELEASE_COMMIT:-}" subject="$SUBJECT" requestedBy="${RELEASE_REQUESTED_BY:-}" computer="${RELEASE_COMPUTER:-}" ip="${RELEASE_REQUESTER_IP:-}" runUrl="${RELEASE_RUN_URL:-}")"
    if approval="$(release_api /api/release-otp/request-approval "$BODY")" \
        && APPROVAL_ID="$(field id <<< "$approval")" && [[ "$APPROVAL_ID" =~ ^[0-9a-f]{16}$ ]]; then
      WAIT="${RELEASE_APPROVAL_WAIT_SECONDS:-600}" POLL="${RELEASE_APPROVAL_POLL_SECONDS:-10}"
      summary "Urgent release: Approve / Reject was sent to the $(field recipient <<< "$approval"). Waiting up to $((WAIT/60)) minutes for a tap."
      DEADLINE=$(( $(date +%s) + WAIT ))
      while (( $(date +%s) < DEADLINE )); do
        sleep "$POLL"
        mint_identity
        decision="$(release_api /api/release-otp/decision "{\"id\":\"${APPROVAL_ID}\"}")" || continue
        case "$(field status <<< "$decision")" in
          approved) summary "Urgent release approved on Telegram by $(field by <<< "$decision"). Releasing main now."; decide true;;
          rejected) summary "Urgent release rejected on Telegram by $(field by <<< "$decision"). Nothing was deployed."; echo "::error::The urgent release was rejected."; exit 1;;
          expired|missing|used) summary "Urgent release: the approval request is no longer active. Nothing was deployed."; echo "::error::The urgent release approval is no longer active."; exit 1;;
        esac
      done
      summary "Urgent release: nobody tapped Approve within $((WAIT/60)) minutes. Nothing was deployed."
      echo "::error::The urgent release was not approved in time."
      exit 1
    fi
    echo "Approval buttons could not be sent ($(field error <<< "${approval:-}")); sending an OTP instead."
    mint_identity
    if result="$(release_api /api/release-otp/request '{}')"; then
      summary "Urgent release: an OTP was sent to the $(field recipient <<< "$result"). Get it from the owner, then Run workflow again with \"Urgent\" and the OTP within $(field expiresInMinutes <<< "$result") minutes. Nothing was deployed yet."
      decide false
    fi
    # Bootstrap: the OTP service ships with a release, so until the first release that carries it
    # Pulse-II answers HTTP 404 and no OTP can ever be sent. Only then, and only for a run started
    # by the repository owner's account, an urgent release goes ahead. Once Pulse-II answers this
    # route at all, every urgent release needs the OTP again. (Owner's decision, 15 Nov 2026
    # 00:35 IST: the 00:00 scheduled release had not started; GitHub starts this repository's
    # timed runs about six hours late.)
    if [[ "$(field error <<< "$result")" == *"HTTP 404: the release OTP service is not live there yet"* \
          && -n "${GITHUB_ACTOR:-}" && "${GITHUB_ACTOR}" == "${GITHUB_REPOSITORY_OWNER:-}" ]]; then
      summary "Urgent release: Pulse-II does not have the release OTP service yet (HTTP 404), so no OTP can be sent. Started by the repository owner (${GITHUB_ACTOR}): releasing main now. This release puts the OTP service live; urgent releases after it need the owner's OTP."
      decide true
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

if [[ "$WINDOW_RUN" != true ]]; then decide false; fi

TODAY_IST="${RELEASE_WINDOW_TODAY:-$(TZ=Asia/Kolkata date +%F)}"
if [[ -n "${SCHEDULE_STARTS:-}" && "$TODAY_IST" < "$SCHEDULE_STARTS" ]]; then
  echo "Scheduled releases start on ${SCHEDULE_STARTS} IST (today is ${TODAY_IST})."
  decide false
fi

# A window release goes out only in the hour after 12:00, 15:00, 18:00 or 00:00
# IST, so a timed run that GitHub starts hours late never deploys mid-shift.
# The backup trigger covers the window; a late duplicate finds nothing new.
WINDOW_GRACE_MINUTES="${WINDOW_GRACE_MINUTES:-59}"
SINCE_WINDOW="$(node -e "const now=Number(process.argv[1])||Date.now(),ist=new Date(now+330*60000),m=ist.getUTCHours()*60+ist.getUTCMinutes();
const last=[0,720,900,1080].filter(x=>x<=m).pop();process.stdout.write(String(m-last))" "${RELEASE_WINDOW_NOW_MS:-}")"
if (( SINCE_WINDOW > WINDOW_GRACE_MINUTES )); then
  summary "Outside a release window (${SINCE_WINDOW} minutes after the last window start; the limit is ${WINDOW_GRACE_MINUTES}). Nothing deployed. Main goes out in the next window, $(next_window)."
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
