/**
 * The scan screen re-reads its open entry so cards appear as handwriting is
 * read and as Pulse confirms equipment. That read used to run every 4 s for as
 * long as the screen was open, in every tab and at every site, even when every
 * card had long been read. Each read takes a database connection, and the
 * 10-connection pool queued saves behind them.
 *
 * Now: every 4 s while something is still changing on the server (cards
 * queued or being read, a Pulse equipment check pending, an upload running),
 * otherwise every 15 s. A hidden tab keeps reading only while that work is
 * still running, because automatic saving depends on seeing the result.
 */
export const SCAN_PROGRESS_ACTIVE_MS = 4000;
export const SCAN_PROGRESS_IDLE_MS = 15000;
export const VLB_CARD_COUNT_POLL_MS = 15000;
// When a poll shows that a few cards changed, the screen reads only those cards
// (`?cards=`) instead of the whole entry: the full read re-validates every
// unsaved card, so reading it once per finished card made the database work
// grow with the square of the entry size. More changed cards than this in one
// poll, and the whole entry is read as before.
export const SCAN_PARTIAL_REFRESH_MAX = 40;
// A card's checks can depend on other cards (duplicates, carried-over meters).
// After partial reads the whole entry is read once more when the work settles,
// and at least this often while it continues.
export const SCAN_FULL_REFRESH_MAX_MS = 60000;

export function scanProgressActive(cards = [], {uploading = false} = {}) {
  if (uploading) return true;
  return (Array.isArray(cards) ? cards : []).some((card) => card && (card.status === 'queued' || card.status === 'reading' || Boolean(card.validationPending)));
}

export function shouldReadScanProgress({active, lastReadAt = 0, now = Date.now(), idleMs = SCAN_PROGRESS_IDLE_MS}) {
  return Boolean(active) || now - lastReadAt >= idleMs;
}

// Opening a scan entry is a whole read: every card's fill and checks. On 14 Nov
// 2026 a 40-card entry took longer than the 20 s the screen used to wait while
// the server was busy, so clicking an entry showed "signal timed out" and no
// cards. The server drops a read the browser gave up on, so waiting longer is
// what gets the entry opened; the slim progress polls keep the short wait.
export const SCAN_ENTRY_OPEN_TIMEOUT_MS = 90000;
export const SCAN_PROGRESS_READ_TIMEOUT_MS = 20000;

export function scanEntryOpenError(error) {
  const name = error?.name;
  if (name === 'TimeoutError' || name === 'AbortError' || /signal timed out|aborted/i.test(String(error?.message || '')))
    return 'The scan entry is taking longer than usual to open because the server is busy. Nothing was lost. Click the entry again to retry.';
  return error?.message || 'The scan entry could not be opened.';
}

// The browser's own words when a timed read is given up ("signal timed out" in
// Chrome/Edge). On 14 Nov 2026 these showed as two bare red lines on the scan
// screen while the server was busy, and the reviewer could not tell that
// nothing was lost.
const RAW_TIMEOUT_TEXT = /^(signal timed out|the operation was aborted due to timeout|the operation timed out\.?|this operation was aborted)$/i;

function isReadTimeout(error) {
  const name = error?.name;
  return name === 'TimeoutError' || name === 'AbortError' || RAW_TIMEOUT_TEXT.test(String(error?.message || '').trim());
}

export const SCAN_BUSY_MESSAGE = 'The server is busy, so this screen is waiting longer than usual for an answer. Nothing was lost. It keeps trying on its own.';

/** What a red banner on the scan screen shows: the browser's raw timeout text becomes a plain explanation. */
export function scanScreenErrorText(message) {
  const text = String(message || '');
  return RAW_TIMEOUT_TEXT.test(text.trim()) ? SCAN_BUSY_MESSAGE : text;
}

// One progress poll that times out only means the list is one read behind; the
// next poll (4-15 s later) usually succeeds. A banner set here also pauses
// automatic saving, so a single slow poll must not show one.
export const SCAN_PROGRESS_FAILURES_BEFORE_NOTICE = 2;

/** Banner text for a failed progress poll, or null to stay quiet and let the next poll retry. */
export function scanProgressPollError(error, failures) {
  if (!isReadTimeout(error)) return error?.message || 'The card list could not refresh.';
  if (failures < SCAN_PROGRESS_FAILURES_BEFORE_NOTICE) return null;
  return 'The card list has not refreshed for a while because the server is busy. Nothing was lost. It keeps retrying on its own.';
}
