#!/usr/bin/env bash
# Merge a pull request into main and make it live, after Mr Anoop or Mr Mohit
# Chadda taps Approve on Telegram (.github/workflows/merge-and-release.yml).
#   1. The pull request must be open, against main, not a draft, mergeable,
#      and every check finished without failing.
#   2. Pulse-II sends both of them Approve / Reject with the PR, its size, who
#      asked, from which computer and IP; this run waits up to ten minutes.
#   3. Approve: the PR is merged exactly as it was shown (same head commit),
#      then the production release is started with the approval, which it
#      spends once. Reject or no answer: nothing is merged.
# Inputs: MERGE_PR, MERGE_REQUESTED_BY, MERGE_COMPUTER, MERGE_IP, RUN_URL,
# GH_TOKEN/GH_REPO for gh, and GitHub's ACTIONS_ID_TOKEN_REQUEST_URL/TOKEN.
set -uo pipefail
summary() { echo "$1"; echo "$1" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"; }
refuse() { summary "$1"; echo "::error::$1"; exit 1; }
source "$(dirname "${BASH_SOURCE[0]}")/release-api.sh"
URGENT='Urgent: deploy now (Mr Anoop or Mr Mohit Chadda approves on Telegram)'

PR="$(tr -d '[:space:]#' <<< "${MERGE_PR:-}")"
[[ "$PR" =~ ^[0-9]{1,6}$ ]] || refuse "Enter the pull request number to merge and release."

# GitHub works out "mergeable" in the background; ask again for a short while.
for attempt in 1 2 3 4 5 6; do
  info="$(gh pr view "$PR" --json state,isDraft,baseRefName,headRefOid,title,mergeable,additions,deletions,changedFiles,statusCheckRollup,url)" || refuse "Pull request #${PR} could not be read."
  [[ "$(field mergeable <<< "$info")" == UNKNOWN ]] || break
  sleep 5
done
[[ "$(field state <<< "$info")" == OPEN ]] || refuse "Pull request #${PR} is not open."
[[ "$(field isDraft <<< "$info")" != true ]] || refuse "Pull request #${PR} is a draft."
[[ "$(field baseRefName <<< "$info")" == main ]] || refuse "Pull request #${PR} does not target main."
[[ "$(field mergeable <<< "$info")" == MERGEABLE ]] || refuse "Pull request #${PR} cannot be merged as it is ($(field mergeable <<< "$info")). Resolve conflicts first."
# Checks: "passed" when every check finished without failing; otherwise the names that block.
checks="$(node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const rows=JSON.parse(s).statusCheckRollup||[];
const name=r=>r.name||r.context||'check',done=r=>(r.status||'COMPLETED')==='COMPLETED'&&r.state!=='PENDING'&&r.state!=='EXPECTED';
const ok=r=>['SUCCESS','NEUTRAL','SKIPPED'].includes(r.conclusion||r.state);
const waiting=rows.filter(r=>!done(r)).map(name),failed=rows.filter(r=>done(r)&&!ok(r)).map(name);
process.stdout.write(waiting.length?'waiting: '+waiting.join(', '):failed.length?'failed: '+failed.join(', '):'passed ('+rows.length+')');})" <<< "$info")"
[[ "$checks" == passed* ]] || refuse "Pull request #${PR} checks are not all green (${checks}). Nothing was sent for approval."
HEAD_SHA="$(field headRefOid <<< "$info")" TITLE="$(field title <<< "$info")"
CHANGES="$(field changedFiles <<< "$info") files, +$(field additions <<< "$info") / -$(field deletions <<< "$info"); checks ${checks}"

mint_identity
body="$(approval_body kind=merge-release prNumber="$PR" prTitle="$TITLE" prHeadSha="$HEAD_SHA" changes="$CHANGES" requestedBy="${MERGE_REQUESTED_BY:-}" computer="${MERGE_COMPUTER:-}" ip="${MERGE_IP:-}" runUrl="${RUN_URL:-}")"
result="$(release_api /api/release-approval/request "$body")" || refuse "The Telegram approval could not be sent. $(field error <<< "$result")"
id="$(field id <<< "$result")"
[[ "$id" =~ ^[0-9a-f-]{36}$ ]] || refuse "Pulse-II did not return an approval reference."
summary "PR #${PR} (${TITLE}): Approve / Reject sent on Telegram to Mr Anoop and Mr Mohit Chadda ($(field sentTo <<< "$result") chats). Waiting up to $(field expiresInMinutes <<< "$result") minutes."

final="$(wait_for_approval "$id")" || refuse "PR #${PR} was not merged: the request was $(approval_outcome "$final")."
APPROVER="$(field decidedBy <<< "$final")"

# Merge exactly what was approved: new commits since the request mean asking again.
NOW_SHA="$(gh pr view "$PR" --json headRefOid --jq .headRefOid)"
[[ "$NOW_SHA" == "$HEAD_SHA" ]] || refuse "PR #${PR} received new commits after the approval request. Nothing was merged; ask again."
gh pr merge "$PR" --merge --match-head-commit "$HEAD_SHA" || refuse "Approved by ${APPROVER}, but GitHub refused to merge PR #${PR}. Nothing was released."
MERGED="$(gh pr view "$PR" --json mergeCommit --jq .mergeCommit.oid)"
summary "Approved on Telegram by ${APPROVER}. PR #${PR} merged into main (${MERGED:0:7})."

# The release spends the approval; GitHub allows this run's token to start it.
gh workflow run main_caliber-mis-783.yml --ref main -f when="$URGENT" -f approval="$id" \
  -f requested_by="${MERGE_REQUESTED_BY:-}" -f computer="${MERGE_COMPUTER:-}" -f ip="${MERGE_IP:-}" \
  || refuse "PR #${PR} is merged, but the production release could not be started. Start Build and deploy main to production with Urgent; it will ask for approval again."
summary "Production release started: ${GITHUB_SERVER_URL:-https://github.com}/${GH_REPO:-${GITHUB_REPOSITORY:-}}/actions/workflows/main_caliber-mis-783.yml"
