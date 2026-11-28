// Caliber One (pulse.cmll.in/one, owner 28 Nov 2026) shows Pulse-II as a tab. Its "Sign out all"
// button asks this tab to sign out of Pulse-II, by a message that only Caliber One itself can send:
// from https://pulse.cmll.in, from the window that holds this tab, never from Pulse-II opened alone.
export const CALIBER_ONE_ORIGIN = 'https://pulse.cmll.in';
export const CALIBER_ONE_SIGN_OUT = 'caliber-one:sign-out';

export function isCaliberOneSignOut(event, self = globalThis.window) {
  const parent = self?.parent;
  return Boolean(parent && parent !== self && event?.source === parent &&
    event.origin === CALIBER_ONE_ORIGIN && event.data?.type === CALIBER_ONE_SIGN_OUT);
}
