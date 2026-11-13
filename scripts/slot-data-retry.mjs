// Tries a slot data read again when the slot stalls or drops the connection, instead of failing the whole release.
// Only requests that change nothing (a file check, a directory listing, a file header) may go through here, so a
// second try can never write, move or delete anything twice.

// The slot answered, but only to say it is busy or restarting.
export class SlotBusyError extends Error {}

export const busyStatus = status => status === 408 || status === 429 || status >= 500;

export function isTransient(error) {
  if (error instanceof SlotBusyError) return true;
  if (['TimeoutError', 'AbortError'].includes(error?.name)) return true;
  return error instanceof TypeError && /fetch failed|terminated/i.test(error.message);
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// The lines this prints go to a public build log: they name the kind of read, never a file or a host.
export async function retryTransient(run, {tries = 3, pauses = [5000, 15000], sleep = wait, report = console.log, what = 'Slot data read'} = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run(attempt);
    } catch (error) {
      if (attempt >= tries || !isTransient(error)) throw error;
      report(`${what} did not answer in time or was cut off; trying again (${attempt + 1} of ${tries}).`);
      await sleep(pauses[Math.min(attempt, pauses.length) - 1]);
    }
  }
}
