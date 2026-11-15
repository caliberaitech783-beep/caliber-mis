// Pulse's gateway gives Pulse 31 seconds to answer and returns 504 after that. While a Pulse
// deployment loads on the shared server, the breakdown feed read can miss that limit for a few
// minutes (14 Nov 2026, 6:00 to 6:15 PM: 94 such 504s). The scan screen then repeats the BD hours
// lookup by itself; the operator keeps the manual BD field meanwhile and need not press Retry.
export const PULSE_HOURS_RETRY_DELAYS_MS=[4000,10000,20000];

const TRANSIENT=/Pulse request failed \((502|503|504)\)|Could not reach pulse\.cmll\.in|Pulse is temporarily unavailable|automatic retry is pending/i;

export function pulseHoursFailureIsTransient(message){return TRANSIENT.test(String(message||''));}

/** Milliseconds to wait before repeating a failed lookup; null when it should not be repeated. */
export function pulseHoursRetryDelayMs(message,attempt){
 return pulseHoursFailureIsTransient(message)&&attempt>=0&&attempt<PULSE_HOURS_RETRY_DELAYS_MS.length?PULSE_HOURS_RETRY_DELAYS_MS[attempt]:null;
}

const SITE_MISMATCH=/must belong to this location/i;
const NOT_CONNECTED=/Connect Pulse|connection unavailable|access expired|was denied/i;

/** True when Pulse refused the BD lookup because the machine is not at the card's site on its date. */
export function pulseHoursSiteMismatch(message){return SITE_MISMATCH.test(String(message||''));}

/**
 * The yellow "User input needed" line for a card whose Pulse BD hours could not be read. It names the
 * reason (15 Nov 2026: the old line only said "Pulse could not provide them", and the reason sat far
 * below under Hours summary, so sites could not tell a slow Pulse from a machine not at the site).
 */
export function pulseHoursReviewMessage(message,{retrying=false}={}){
 const reason=String(message||'').trim().replace(/\.$/,'')||'no answer';
 if(SITE_MISMATCH.test(reason))return 'BD hours not checked: Pulse does not show this machine at this site on this date. Process its pending transfer in Pulse or open Equipment review, then press Retry Pulse lookup, or enter BD hours manually.';
 if(pulseHoursFailureIsTransient(reason))return retrying?'BD hours not checked: Pulse did not answer in time ('+reason+'). Trying again automatically; you can also enter BD hours manually.':'BD hours not checked: Pulse did not answer in time ('+reason+'). Press Retry Pulse lookup, or enter BD hours manually.';
 if(NOT_CONNECTED.test(reason))return 'BD hours not checked: Pulse is not connected for breakdown hours ('+reason+'). Enter BD hours manually.';
 return 'BD hours not checked: Pulse could not provide them ('+reason+'). Press Retry Pulse lookup, or enter BD hours manually.';
}
