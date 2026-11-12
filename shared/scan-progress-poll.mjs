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
