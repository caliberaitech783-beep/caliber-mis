// One driver, one shift, one payment (owner, 23 Nov 2026).
// A card that takes its driver's working hours of the shift beyond the shift, because he already has a card on
// another vehicle in it, is refused once by the server (server/rules/log-book-shift-hmr.mjs) under this code. The
// manual VLB form and the scan review then put one question to the person who has the paper card; a Yes saves the
// card under the same driver, and attendance still counts one shift for him.
export const DRIVER_SHIFT_CODE='driver_shift_hmr_limit';
export const driverShiftQuestion=(message,driver='')=>String(message||'').trim()
 +'\n\nDid '+(String(driver||'').trim()||'this driver')+' also drive this vehicle in this shift?'
 +'\nOK = Yes: save this card under the same driver. One shift is counted.'
 +'\nCancel = No: I will check the number on the card.';
