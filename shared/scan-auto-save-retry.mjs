/**
 * Automatic saving of a scanned card used to stop at the first card whose
 * request met a busy server (HTTP 503 "reconnecting to the database", a
 * gateway 502/504 during a restart, a dropped connection or a timeout), and
 * the reviewer had to press "Retry automatic save" by hand.
 *
 * Replaying this one write is safe: POST /api/scan-cards/:id/auto-save takes
 * the batch lock and answers with the existing log book when the card is
 * already posted, so a second attempt can never save a card twice.
 */

// Waits before attempts 2..7; together a little under two minutes.
export const AUTO_SAVE_BUSY_DELAYS_MS = [5000, 10000, 15000, 20000, 30000, 30000];

/** True when the failure says "the server could not answer right now", not "this card is wrong". */
export function isBusyAutoSaveError(error) {
  if (!error || typeof error !== 'object') return false;
  if (error.transient === true) return true;
  if (error.name === 'TimeoutError') return true;
  if (error.name === 'AbortError') return false;
  return error.name === 'TypeError' && /failed to fetch|networkerror|load failed|network request failed/i.test(String(error.message || ''));
}

/**
 * Runs `perform()` and, while it fails because the server is busy, waits and
 * runs it again. Resolves with the first successful result. Rejects with the
 * original error for any other failure, when `shouldContinue()` turns false,
 * or once every wait has been used; in that last case the error carries
 * `busyExhausted: true` and `attempts`.
 */
export async function autoSaveWithBusyRetry(perform, {
  delays = AUTO_SAVE_BUSY_DELAYS_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onWait = () => {},
  shouldContinue = () => true,
} = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await perform(attempt);
    } catch (error) {
      if (!isBusyAutoSaveError(error) || !shouldContinue()) throw error;
      if (attempt >= delays.length) {
        error.busyExhausted = true;
        error.attempts = attempt + 1;
        throw error;
      }
      onWait({ attempt: attempt + 1, nextAttempt: attempt + 2, totalAttempts: delays.length + 1, delayMs: delays[attempt], error });
      await sleep(delays[attempt]);
      if (!shouldContinue()) throw error;
    }
  }
}

export function busyAutoSaveStoppedMessage(attempts) {
  return 'The server stayed busy through ' + attempts + ' tries, so automatic saving will retry in one minute. No card was lost.';
}
