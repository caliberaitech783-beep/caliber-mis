// Whether a production release should send the off-schedule Telegram notice.
// No notice when a release window allowed it (GitHub's timer, or the Pulse-II backup start with
// "Scheduled window now"), or when someone tapped Approve on Telegram (an urgent run or
// "Merge a PR and make it live"): the release-alert people approved it there themselves
// (owner, 15 Nov 2026). An OTP release, the bootstrap release, or a run whose approval is not
// known still tells them.
export function offScheduleNoticeNeeded({trigger = '', when = '', approval = ''} = {}) {
  if (trigger === 'schedule') return false;
  if (String(when).startsWith('Scheduled window')) return false;
  if (approval === 'window' || approval === 'telegram') return false;
  return true;
}
