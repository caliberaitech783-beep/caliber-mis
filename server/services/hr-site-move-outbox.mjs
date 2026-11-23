// A site move made in Pulse-II reaches HR Pulse at once (owner, 23 Nov 2026: "it should be two-way ... anything
// which MIS changes during batch creation should get auto updated in HR employee master also").
//
// The one change the MIS makes to an employee while a batch is made is the site move with an OTP on a card
// (server/routes/employee-site-move.mjs). When such a move changes the site held today, it is written to
// mis_hr_site_move_outbox in the same transaction, so a move can never be saved without its message.
// This service sends the waiting ones to HR Pulse: right after the OTP, and again every minute until HR Pulse
// answers. HR Pulse takes a move once (its id), so sending one twice is harmless.
//  - "applied": HR Pulse's Employee Master shows the new site; the move is kept there as an approved transfer.
//  - "held": HR Pulse could not place it (for example the number is on two lines there). Nothing changed in
//    HR Pulse; the reason is shown on Sync all masters, and HR corrects its line.
// A move that came from HR Pulse (a transfer, or its master) and a move that only fills in history are never sent.
export const HR_SITE_MOVE_OUTBOX_SCHEMA=`CREATE TABLE IF NOT EXISTS mis_hr_site_move_outbox(
 move_id BIGINT PRIMARY KEY,payload JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),tries INTEGER NOT NULL DEFAULT 0,
 last_try_at TIMESTAMPTZ,sent_at TIMESTAMPTZ,outcome TEXT NOT NULL DEFAULT '',detail TEXT NOT NULL DEFAULT '')`;
export const QUEUE_SITE_MOVE_SQL='INSERT INTO mis_hr_site_move_outbox(move_id,payload) VALUES($1,$2::jsonb) ON CONFLICT(move_id) DO NOTHING';
const WAITING_SQL='SELECT move_id,payload,tries FROM mis_hr_site_move_outbox WHERE sent_at IS NULL ORDER BY move_id LIMIT 20';
const SENT_SQL="UPDATE mis_hr_site_move_outbox SET sent_at=NOW(),last_try_at=NOW(),tries=tries+1,outcome=$2,detail=$3 WHERE move_id=$1 AND sent_at IS NULL";
const FAILED_SQL='UPDATE mis_hr_site_move_outbox SET last_try_at=NOW(),tries=tries+1,detail=$2 WHERE move_id=$1 AND sent_at IS NULL';
const STATUS_SQL=`SELECT (SELECT count(*) FROM mis_hr_site_move_outbox WHERE sent_at IS NULL) AS waiting,
 (SELECT min(created_at) FROM mis_hr_site_move_outbox WHERE sent_at IS NULL) AS waiting_since,
 (SELECT max(sent_at) FROM mis_hr_site_move_outbox) AS last_sent`;
const RECENT_SQL=`SELECT move_id,payload,created_at,sent_at,tries,outcome,detail FROM mis_hr_site_move_outbox
 WHERE sent_at IS NULL OR outcome='held' ORDER BY move_id DESC LIMIT 50`;
const text=value=>value===null||value===undefined?'':String(value).trim();

// What HR Pulse is told about a move: who, from where to where, from which date, who asked and who gave the OTP.
export const siteMovePayload=({moveId,employeeId,name,from,to,fromDate,requestedBy,requestedName,approvedBy,card})=>({moveId:String(moveId),employeeId:text(employeeId),name:text(name),fromSite:text(from),toSite:text(to),fromDate:text(fromDate),
 requestedBy:text(requestedBy),requestedName:text(requestedName),approvedBy:(Array.isArray(approvedBy)?approvedBy:[]).map(text).filter(Boolean),card:{door:text(card?.door),cardNo:text(card?.cardNo)}});

export function createHrSiteMoveOutbox({pool,hr}){
 let schema=null,sending=null;
 const ensure=()=>schema??=pool.query(HR_SITE_MOVE_OUTBOX_SCHEMA).catch(error=>{schema=null;throw error;});
 async function send(){
  await ensure();
  if(!hr.configured())return {sent:0,held:0,failed:0,skipped:'not connected'};
  const {rows}=await pool.query(WAITING_SQL);
  let sent=0,held=0,failed=0;
  for(const row of rows){
   try{
    const answer=await hr.sendSiteMove(row.payload);
    const outcome=text(answer?.outcome)||'applied';
    await pool.query(SENT_SQL,[row.move_id,outcome,text(answer?.detail).slice(0,500)]);
    if(outcome==='held')held++;else sent++;
   }catch(error){
    failed++;
    await pool.query(FAILED_SQL,[row.move_id,(error?.status?error.message:'HR Pulse did not answer.').slice(0,500)]).catch(()=>{});
   }
  }
  return {sent,held,failed};
 }
 return {
  // One sender at a time in this server; a second call joins the one that is running.
  flush(){return sending??=send().finally(()=>{sending=null;});},
  async status(){
   await ensure();
   const totals=(await pool.query(STATUS_SQL)).rows[0]||{},list=(await pool.query(RECENT_SQL)).rows;
   const line=row=>({moveId:String(row.move_id),employeeId:text(row.payload?.employeeId),name:text(row.payload?.name),from:text(row.payload?.fromSite),to:text(row.payload?.toSite),fromDate:text(row.payload?.fromDate),
    createdAt:row.created_at,sentAt:row.sent_at,tries:Number(row.tries||0),outcome:text(row.outcome),detail:text(row.detail)});
   return {waiting:Number(totals.waiting||0),waitingSince:totals.waiting_since||null,lastSentAt:totals.last_sent||null,
    notSent:list.filter(row=>!row.sent_at).map(line),held:list.filter(row=>row.sent_at&&row.outcome==='held').map(line)};
  },
 };
}
