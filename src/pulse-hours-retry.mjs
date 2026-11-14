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
