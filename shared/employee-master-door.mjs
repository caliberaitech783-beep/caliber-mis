// Owner, 23 Nov 2026: HR Pulse is the final authority for Employee Master. An employee is created, edited
// and deleted only in HR Pulse. In Pulse-II every door that adds, edits or deletes an employee is switched
// off ("stop it and switch it off till the time I allow from my Telegram"):
//   - Employee Master: New employee, Edit employee, Import CSV / JSON;
//   - HR's master Excel: Apply;
//   - Employee Current Location: Save;
//   - the general master routes, for Employee master (those stay refused whatever the door says).
// A door opens only after the owner taps Allow on Telegram, for DOOR_OPEN_MINUTES, and closes by itself.
//
// What stays, because it happens while a batch is made and not on the Employee Master page: the site move with
// OTP on a card (server/routes/employee-site-move.mjs), the "drives this vehicle" mark on Fetch, and the
// transfers HR has approved (server/services/hr-employee-sync.mjs).
export const EMPLOYEE_MASTER_DOOR_KEY='employee_master_door';
// How long one Allow keeps the doors open, and how long the buttons wait for a tap.
export const DOOR_OPEN_MINUTES=30;
export const DOOR_ASK_TTL_MINUTES=20;
export const DOOR_ASK_RESEND_SECONDS=60;
export const EMPLOYEE_MASTER_LOCKED='Employee Master is changed only in HR Pulse. Adding, editing and deleting employees is switched off in Pulse-II. It opens only when the owner allows it on Telegram.';

const time=value=>value?new Date(value).getTime():0;
export const doorOpen=(state,now=Date.now())=>time(state?.openUntil)>now;
export const askWaiting=(state,now=Date.now())=>state?.ask?.status==='awaiting'&&time(state.ask.expiresAt)>now;
export const askTooSoon=(state,now=Date.now())=>Boolean(state?.ask?.at)&&now-time(state.ask.at)<DOOR_ASK_RESEND_SECONDS*1000;

// What the screens show. No Telegram chat, no button id.
export function doorStatus(state,now=Date.now()){
 const open=doorOpen(state,now),ask=state?.ask||null;
 return {open,openUntil:open?state.openUntil:null,allowedBy:open?String(state.allowedBy||''):'',openMinutes:DOOR_OPEN_MINUTES,message:EMPLOYEE_MASTER_LOCKED,
  asked:ask?{by:String(ask.name||ask.by||''),at:ask.at,reason:String(ask.reason||''),status:ask.status==='awaiting'&&!askWaiting(state,now)?'expired':ask.status,decidedBy:String(ask.decidedBy||'')}:null};
}
export const istClock=value=>new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
