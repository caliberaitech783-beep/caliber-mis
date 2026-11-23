// The re-check of saved cards against Employee Master, and the one correction run (owner, 22 Nov 2026).
//
//  1. GET  /api/caliber-recheck        every saved card of the dates is judged again (shared/caliber-recheck.mjs);
//                                      the cards whose driver or operator does not stand are listed, site by site.
//  2. POST /api/caliber-recheck/pick   the site names the right driver for one listed card, from the paper card, and
//                                      that driver is put on the card at once (owner, 23 Nov 2026: "build one step
//                                      submit"; until then the pick waited for the run below, and the sites read the
//                                      waiting line as "not submitted"). The card keeps who was on it before, who
//                                      changed it and when; its batch copy follows and its revision rises, so the stored
//                                      attendance of that day is built again. A refusal changes nothing and is said
//                                      on the card's line. DELETE .../correction/:id is Undo: the earlier person goes
//                                      back on the card.
//  3. POST /api/caliber-recheck/apply  the correction run, kept for the picks that were still waiting when Submit
//                                      became one step: every waiting pick is put on its card together.
//  4. GET  /api/caliber-recheck/record the corrections done, for HR.
//  5. POST /api/caliber-recheck/confirm  "This card is right" (owner, 23 Nov 2026): the paper card shows the saved
//                                      driver, so the card leaves the list. Only for a card listed because its FORM A
//                                      box names a colleague (shared/caliber-recheck.mjs); who said so and when is kept,
//                                      and DELETE .../confirm/:id takes it back. GET .../confirmed lists them.
// The run can be repeated at any time: a card that was corrected passes the re-check and leaves the list.
//
// A correction changes only who is on the card: employeeId, employeeName and caliberId. It does so in closed and locked
// batches too, because that is what it is for (the cards of 1 Nov onwards are locked); that is why the driver is
// checked again as it is put on the card, why every change is recorded with who made it, and why it can be undone.
// Whoever may choose the driver may correct the card (owner, 23 Nov 2026): the site holds the paper card, and the
// separate administrator run checked nothing the site had not already seen.
import {readScanMasters} from '../services/scan-master-cache.mjs';
import {SCAN_MASTER_NAMES} from '../services/a-form-people-index.mjs';
import {logBookSiteScope,siteAllowed,requireLogBookSite,employeeAtLocation,employeeOnHrList} from '../../shared/log-book-access.mjs';
import {recheckSavedCard,recheckCounts,RECHECK_REASONS,canConfirmSaved,canRefreshFromHr,confirmationHolds} from '../../shared/caliber-recheck.mjs';
import {needsDriverConfirm,employeeLeft,employeeDesignation,fetchRefusal} from '../../shared/caliber-id-check.mjs';
import {employeeIdentity} from '../../shared/employee-identity.mjs';
import {isMisAdministrator} from '../../shared/mis-admin-access.mjs';
import {vlbRecordShift} from '../../shared/vlb-batch-format.mjs';
import {shareCardOperator} from '../../shared/log-book-shared-shift.mjs';
import {findOtherVlbCards} from '../rules/vlb-duplicate-card.mjs';
import {OPERATIONAL_START} from '../../shared/operational-start.mjs';
import {displaySiteName} from '../../shared/region-scope.mjs';
import {canonicalSiteName} from '../../shared/site-location.mjs';
import {isBookDate} from '../../shared/employee-site-moves.mjs';

export const CALIBER_RECHECK_SCHEMA=`
 CREATE TABLE IF NOT EXISTS mis_caliber_corrections(
  id BIGSERIAL PRIMARY KEY,logbook_id BIGINT NOT NULL,book_no TEXT NOT NULL DEFAULT '',book_type TEXT NOT NULL,book_date TEXT NOT NULL,site TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',old_employee_id TEXT NOT NULL DEFAULT '',old_caliber_id TEXT NOT NULL DEFAULT '',old_name TEXT NOT NULL DEFAULT '',
  new_employee_id TEXT NOT NULL,new_caliber_id TEXT NOT NULL,new_name TEXT NOT NULL DEFAULT '',
  picked_by TEXT NOT NULL,picked_name TEXT NOT NULL DEFAULT '',picked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','cancelled')),
  applied_by TEXT,applied_name TEXT,applied_at TIMESTAMPTZ,note TEXT NOT NULL DEFAULT '');
 CREATE UNIQUE INDEX IF NOT EXISTS mis_caliber_corrections_one_pending ON mis_caliber_corrections(logbook_id) WHERE status='pending';
 CREATE INDEX IF NOT EXISTS mis_caliber_corrections_done ON mis_caliber_corrections(applied_at DESC) WHERE status='applied';
 CREATE TABLE IF NOT EXISTS mis_caliber_confirmed_cards(
  id BIGSERIAL PRIMARY KEY,logbook_id BIGINT NOT NULL,book_no TEXT NOT NULL DEFAULT '',book_type TEXT NOT NULL,book_date TEXT NOT NULL,site TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',employee_id TEXT NOT NULL DEFAULT '',caliber_id TEXT NOT NULL DEFAULT '',name TEXT NOT NULL DEFAULT '',
  a_form TEXT NOT NULL DEFAULT '',named_id TEXT NOT NULL DEFAULT '',named_name TEXT NOT NULL DEFAULT '',
  confirmed_by TEXT NOT NULL,confirmed_name TEXT NOT NULL DEFAULT '',confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','withdrawn')),withdrawn_by TEXT,withdrawn_at TIMESTAMPTZ);
 CREATE UNIQUE INDEX IF NOT EXISTS mis_caliber_confirmed_cards_one ON mis_caliber_confirmed_cards(logbook_id) WHERE status='confirmed';`;

const text=value=>String(value??'').trim();
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
// Only the fields the re-check reads leave the database: the cards themselves (trips, meters) stay there. Each card is
// opened once (jsonb_to_record), not once per field. A day holds about 3,700 cards, so the screen asks day by day
// and the server refuses more than RECHECK_MAX_DAYS at a time: one long read of every card since 1 Nov would hold a
// connection of the live server for many seconds.
export const RECHECK_MAX_DAYS=7;
export const RECHECK_CARDS_SQL=`SELECT l.id,l.book_no,l.book_type,l.book_date::text AS date,l.site,
  COALESCE(x."employeeId",'') AS employee_id,COALESCE(x."caliberId",'') AS caliber_id,COALESCE(x."employeeName",'') AS employee_name,
  COALESCE(x."aFormNo",'') AS a_form,COALESCE(x."jobCardNo",'') AS job_card,COALESCE(x.door,'') AS door,
  COALESCE(x."bookShiftCode",'') AS book_shift,COALESCE(x."cardShift",'') AS card_shift,COALESCE(x."shiftName",'') AS shift_name,
  COALESCE(x."scanCardId",'') AS scan_card_id
 FROM mis_log_books l CROSS JOIN LATERAL jsonb_to_record(l.data) AS x("employeeId" text,"caliberId" text,"employeeName" text,"aFormNo" text,"jobCardNo" text,door text,"bookShiftCode" text,"cardShift" text,"shiftName" text,"scanCardId" text)
 WHERE l.deleted_at IS NULL AND l.book_date>=$1::date AND l.book_date<=$2::date ORDER BY l.book_date,l.id`;
const PENDING_SQL="SELECT id,logbook_id,new_employee_id,new_caliber_id,new_name,picked_by,picked_name,picked_at,note FROM mis_caliber_corrections WHERE status='pending'";
// The confirmations of the dates asked (book_date is kept as YYYY-MM-DD text, so it compares as a date does).
const CONFIRMED_OF_DATES_SQL="SELECT logbook_id,employee_id,a_form FROM mis_caliber_confirmed_cards WHERE status='confirmed' AND book_date>=$1 AND book_date<=$2";
// The cards of the dates asked that carry a correction (one taken back is 'cancelled', so it is not counted).
const CORRECTED_OF_DATES_SQL="SELECT DISTINCT logbook_id FROM mis_caliber_corrections WHERE status='applied' AND book_date>=$1 AND book_date<=$2";
const CONFIRMED_SQL="SELECT id,logbook_id,book_no,book_type,book_date,site,caliber_id,name,a_form,named_id,named_name,confirmed_by,confirmed_name,confirmed_at FROM mis_caliber_confirmed_cards WHERE status='confirmed' ORDER BY confirmed_at DESC,id DESC LIMIT 20000";
const WITHDRAW_SQL="UPDATE mis_caliber_confirmed_cards SET status='withdrawn',withdrawn_by=$2,withdrawn_at=NOW() WHERE logbook_id=$1 AND status='confirmed'";
const CANCEL_PICK_SQL="UPDATE mis_caliber_corrections SET status='cancelled' WHERE logbook_id=$1 AND status='pending'";
const CARD_SQL="SELECT id,book_no,book_type,book_date::text AS date,site,revision,data FROM mis_log_books WHERE id=$1 AND deleted_at IS NULL AND book_date>=$2::date";
const EMPLOYEE_SQL="SELECT id,master_name,record_data FROM master_records WHERE id=$1 AND master_name=ANY($2::text[])";
const EMPLOYEE_LISTS=['Employee master','ERP Employee master','C-Dir Employee master'];
const UPDATE_CARD_SQL='UPDATE mis_log_books SET data=data||$2::jsonb,updated_at=NOW(),revision=revision+1 WHERE id=$1 AND deleted_at IS NULL RETURNING id,book_no,book_type,data,revision,created_at,updated_at';
// Undo: the earlier person goes back on the card and the correction's mark leaves it (an older mark, if the card had
// been corrected before, comes back with the patch).
const UNDO_CARD_SQL="UPDATE mis_log_books SET data=(data-'caliberCorrection'::text)||$2::jsonb,updated_at=NOW(),revision=revision+1 WHERE id=$1 AND deleted_at IS NULL RETURNING id,book_no,book_type,data,revision,created_at,updated_at";
const RECORD_SQL="SELECT id,logbook_id,book_no,book_type,book_date,site,reason,old_caliber_id,old_name,new_caliber_id,new_name,picked_name,picked_by,picked_at,applied_name,applied_by,applied_at FROM mis_caliber_corrections WHERE status='applied' ORDER BY applied_at DESC,id DESC LIMIT 20000";

const shiftOf=row=>vlbRecordShift({bookShiftCode:row.book_shift,cardShift:row.card_shift,shiftName:row.shift_name})||text(row.shift_name)||'';
const kindLabel=type=>type==='equipment'?'ELB':type==='lmv'?'LMV':'VLB';
const publicPick=row=>row?{id:String(row.id),employeeId:row.new_caliber_id,name:row.new_name,by:row.picked_name||row.picked_by,at:row.picked_at,note:row.note||''}:null;

// May this employee be put on a card of this site and date? Returns '' when yes, or the plain reason why not.
export function pickRefusal(record,{site,date,kind='vehicle'}){
 if(!record)return 'This employee is no longer in Employee Master.';
 if(!employeeOnHrList(record)||!employeeAtLocation(record,site,date))return fetchRefusal(record,displaySiteName(site)||site,date);
 if(employeeLeft(record))return 'Employee Master says this person has resigned. Choose the person who '+(kind==='equipment'?'operated the machine.':'drove the vehicle.');
 if(needsDriverConfirm(record))return (text(record.name||record.employee)||'This person')+' is '+(employeeDesignation(record)||'not a driver or operator')+'. Confirm on the Fetch box that this person '+(kind==='equipment'?'operated the machine':'drove the vehicle')+', then choose again.';
 return '';
}

// Puts one waiting pick on its card, inside the caller's transaction. Returns {applied:true} or {refused:reason}.
// The pick is checked again here: the card or Employee Master may have changed since it was made.
export async function applyCaliberCorrection(client,pick,{by,byName='',at=new Date().toISOString()}){
 const card=(await client.query(CARD_SQL+' FOR UPDATE',[pick.logbook_id,OPERATIONAL_START])).rows[0];
 if(!card)return {refused:'The card was deleted.'};
 const data=card.data||{};
 if(String(data.employeeId??'')!==String(pick.old_employee_id??''))return {refused:'The card was changed after this driver was chosen. Choose again.'};
 const employee=(await client.query(EMPLOYEE_SQL,[pick.new_employee_id,EMPLOYEE_LISTS])).rows[0];
 const kind=card.book_type==='equipment'?'equipment':'vehicle';
 const refusal=pickRefusal(employee?.record_data,{site:card.site,date:card.date,kind});
 if(refusal)return {refused:refusal};
 const identity=employeeIdentity(employee.record_data),name=text(employee.record_data.name||employee.record_data.employee);
 const next={...data,employeeId:String(employee.id),employeeName:name,caliberId:identity.employeeId};
 // The same driver may not hold two cards of one tipper in one shift (server/rules/vlb-duplicate-card.mjs).
 if(card.book_type==='vehicle'){
  const twin=(await findOtherVlbCards(client,next,card.id)).find(row=>!row.additional&&shareCardOperator(next,row.data));
  if(twin)return {refused:name+' already has card '+twin.bookNo+' for this vehicle in this shift. Check both cards.'};
 }
 // The mark of an earlier correction of this card is kept inside the new one, so Undo can put it back.
 const patch={employeeId:next.employeeId,employeeName:next.employeeName,caliberId:next.caliberId,
  caliberCorrection:{correctionId:String(pick.id),fromEmployeeId:text(data.employeeId),fromCaliberId:text(data.caliberId),fromName:text(data.employeeName),reason:pick.reason||'',pickedBy:pick.picked_by,at,by,...(data.caliberCorrection?{earlier:data.caliberCorrection}:{})}};
 const saved=(await client.query(UPDATE_CARD_SQL,[card.id,JSON.stringify(patch)])).rows[0];
 await followBatchCopy(client,card,saved);
 await client.query("UPDATE mis_caliber_corrections SET status='applied',applied_by=$2,applied_name=$3,applied_at=$4,new_caliber_id=$5,new_name=$6,note='' WHERE id=$1",[pick.id,by,byName,at,identity.employeeId,name]);
 return {applied:true,bookNo:card.book_no,from:text(data.caliberId),to:identity.employeeId};
}
// The batch keeps its own copy of each card; it follows the card. (LMV cards have no batch copy.)
async function followBatchCopy(client,card,saved){
 const copy=card.book_type==='vehicle'?'mis_vlb_batch_entries':card.book_type==='equipment'?'mis_elb_batch_entries':null;
 if(copy&&(await client.query('SELECT to_regclass($1) AS present',[copy])).rows[0]?.present)await client.query('UPDATE '+copy+' SET snapshot=$2::jsonb WHERE logbook_id=$1',[card.id,JSON.stringify(saved)]);
}

// Undo of one correction, inside the caller's transaction: the person who was on the card before goes back on it.
// Only while the card is still as the correction left it; a card changed since is not touched. Returns
// {undone:true,…} or {refused:reason}. The card is then judged afresh by the list, so it is listed again.
export async function undoCaliberCorrection(client,correction,{by,byName='',at=new Date().toISOString()}){
 const live=(await client.query("SELECT id FROM mis_caliber_corrections WHERE id=$1 AND status='applied' FOR UPDATE",[correction.id])).rows[0];
 if(!live)return {refused:'This correction was already taken back.'};
 const card=(await client.query(CARD_SQL+' FOR UPDATE',[correction.logbook_id,OPERATIONAL_START])).rows[0];
 if(!card)return {refused:'The card was deleted.'};
 const data=card.data||{},mark=data.caliberCorrection||{};
 if(String(mark.correctionId??'')!==String(correction.id)||String(data.employeeId??'')!==String(correction.new_employee_id??''))return {refused:'The card was changed after this correction, so it cannot be taken back from here.'};
 const patch={employeeId:text(mark.fromEmployeeId),employeeName:text(mark.fromName),caliberId:text(mark.fromCaliberId),...(mark.earlier?{caliberCorrection:mark.earlier}:{})};
 const saved=(await client.query(UNDO_CARD_SQL,[card.id,JSON.stringify(patch)])).rows[0];
 await followBatchCopy(client,card,saved);
 await client.query("UPDATE mis_caliber_corrections SET status='cancelled',note=$2 WHERE id=$1",[correction.id,('Taken back by '+(byName||by)+' on '+at).slice(0,400)]);
 // A "This card is right" that came with the correction (its FORM A box) was about the driver now taken off.
 await client.query(WITHDRAW_SQL,[card.id,by]);
 return {undone:true,bookNo:card.book_no,from:text(data.caliberId),fromName:text(data.employeeName),to:patch.caliberId,toName:patch.employeeName};
}

export function registerCaliberRecheck(app,{pool,requireSession,requireAdministrator,getSiteScope=async session=>logBookSiteScope(session),readMasters=client=>readScanMasters(client,SCAN_MASTER_NAMES)}){
 let schema=null;
 const ensureSchema=()=>schema??=pool.query(CALIBER_RECHECK_SCHEMA).catch(error=>{schema=null;throw error;});
 const transaction=async fn=>{const client=await pool.connect();try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}};
 const wrap=fn=>async(req,res,next)=>{try{await ensureSchema();res.set('Cache-Control','no-store');await fn(req,res)}catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e)}};
 const protect=[requireSession,requireAdministrator];
 const login=req=>text(req.session?.login||req.session?.name).toLowerCase(),nameOf=req=>text(req.session?.name||req.session?.login);
 const today=()=>new Date(Date.now()+5.5*3600000).toISOString().slice(0,10);
 const period=query=>{
  const to=isBookDate(query.to)?query.to:today(),from=isBookDate(query.from)&&query.from>=OPERATIONAL_START?query.from:OPERATIONAL_START;
  if(from>to)fail('The From date is after the To date.');
  if((Date.parse(to)-Date.parse(from))/86400000>=RECHECK_MAX_DAYS)fail('Ask for at most '+RECHECK_MAX_DAYS+' days at a time.');
  return {from,to};
 };

 app.get('/api/caliber-recheck',...protect,wrap(async(req,res)=>{
  const scope=await getSiteScope(req.session),{from,to}=period(req.query),started=Date.now();
  const [masters,cards,picks,kept,done]=await Promise.all([readMasters(pool).then(result=>result.rows),pool.query(RECHECK_CARDS_SQL,[from,to]).then(result=>result.rows),pool.query(PENDING_SQL).then(result=>result.rows),pool.query(CONFIRMED_OF_DATES_SQL,[from,to]).then(result=>result.rows),pool.query(CORRECTED_OF_DATES_SQL,[from,to]).then(result=>result.rows)]);
  const waiting=new Map(picks.map(row=>[String(row.logbook_id),row])),right=new Map(kept.map(row=>[String(row.logbook_id),row])),changed=new Set(done.map(row=>String(row.logbook_id))),sites=new Map(),listed=[];
  let judged=0,confirmed=0,corrected=0;
  for(const row of cards){
   if(!siteAllowed(scope,row.site))continue;
   judged++;
   const key=canonicalSiteName(row.site)||row.site;
   if(!sites.has(key))sites.set(key,{key,site:displaySiteName(row.site)||row.site,cards:0,listed:0,picked:0,confirmed:0,corrected:0});
   const site=sites.get(key);site.cards++;
   // A card that carries a correction is counted, so the work done shows after its line has left the list.
   if(changed.has(String(row.id))){site.corrected++;corrected++;}
   const verdict=recheckSavedCard(masters,{kind:row.book_type,site:row.site,date:row.date,employeeId:row.employee_id,caliberId:row.caliber_id,aFormNo:row.a_form});
   if(!verdict)continue;
   // A person confirmed this card from the paper card: it is counted, not listed.
   if(confirmationHolds(right.get(String(row.id)),{employeeId:row.employee_id,aFormNo:row.a_form},verdict)){site.confirmed++;confirmed++;continue;}
   const pick=publicPick(waiting.get(String(row.id)));
   site.listed++;if(pick)site.picked++;
   listed.push({id:String(row.id),bookNo:row.book_no,book:kindLabel(row.book_type),kind:row.book_type==='equipment'?'equipment':'vehicle',date:row.date,shift:shiftOf(row),siteKey:key,site:site.site,door:row.door,
    cardNo:row.book_type==='equipment'?row.job_card:row.a_form,scanned:Boolean(row.scan_card_id),scanCardId:row.scan_card_id||'',savedId:row.caliber_id,savedName:row.employee_name,
    reason:verdict.reason,reasonLabel:RECHECK_REASONS[verdict.reason],line:verdict.line,lookAlikes:verdict.lookAlikes||[],more:verdict.more||0,aForm:verdict.aForm||null,canConfirm:canConfirmSaved(verdict),
    // HR settles this one: the line says so and has a Refresh that asks HR Pulse for the saved number.
    canRefresh:canRefreshFromHr(verdict),pick});
  }
  res.json({from,to,cards:judged,listed,counts:recheckCounts(listed),sites:[...sites.values()].sort((a,b)=>b.listed-a.listed||a.site.localeCompare(b.site)),
   picked:listed.filter(row=>row.pick).length,confirmed,corrected,canApply:isMisAdministrator(req.session),tookMs:Date.now()-started});
 }));

 // "This card is right": the paper card shows the driver the card is saved under. Returns {confirmed:true}, or
 // {confirmed:false} with stands (the card passes by itself, nothing to confirm) or refused (why a person cannot
 // settle this card with a tick). A choice that was waiting for the card is dropped when the card is settled.
 const confirmSaved=async(req,card)=>{
  const data=card.data||{},kind=card.book_type==='equipment'?'equipment':'vehicle';
  const masters=(await readMasters(pool)).rows;
  const verdict=recheckSavedCard(masters,{kind:card.book_type,site:card.site,date:card.date,employeeId:data.employeeId,caliberId:data.caliberId,aFormNo:data.aFormNo});
  if(!verdict){await pool.query(CANCEL_PICK_SQL,[card.id]);return {confirmed:false,stands:true};}
  if(!canConfirmSaved(verdict))return {confirmed:false,refused:'This card cannot be confirmed as right. '+verdict.line};
  const employee=/^\d{1,18}$/.test(text(data.employeeId))?(await pool.query(EMPLOYEE_SQL,[text(data.employeeId),EMPLOYEE_LISTS])).rows[0]:null;
  const refusal=pickRefusal(employee?.record_data,{site:card.site,date:card.date,kind});
  if(refusal)return {confirmed:false,refused:refusal};
  const identity=employeeIdentity(employee.record_data),name=text(employee.record_data.name||employee.record_data.employee);
  await transaction(async client=>{
   await client.query(CANCEL_PICK_SQL,[card.id]);
   await client.query(WITHDRAW_SQL,[card.id,login(req)]);
   await client.query('INSERT INTO mis_caliber_confirmed_cards(logbook_id,book_no,book_type,book_date,site,reason,employee_id,caliber_id,name,a_form,named_id,named_name,confirmed_by,confirmed_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
    [card.id,card.book_no,card.book_type,card.date,card.site,verdict.reason,text(data.employeeId),identity.employeeId,name,text(data.aFormNo),text(verdict.aForm?.id),text(verdict.aForm?.name),login(req),nameOf(req)]);
  });
  req.audit={eventType:'Log book',module:'Caliber ID re-check',action:'Confirm the saved driver',targetType:'Log book',targetReference:card.book_no,details:{driver:identity.employeeId,name,site:card.site,date:card.date,formA:text(data.aFormNo),formANames:text(verdict.aForm?.id)}};
  return {confirmed:true,card:{bookNo:card.book_no,employeeId:identity.employeeId,name}};
 };

 // The site names the right driver for one listed card. The employee comes from the Fetch box (its master line id).
 app.post('/api/caliber-recheck/pick',...protect,wrap(async(req,res)=>{
  const scope=await getSiteScope(req.session),logbookId=text(req.body?.logbookId),employeeId=text(req.body?.employeeId);
  if(!/^\d{1,18}$/.test(logbookId)||!/^\d{1,18}$/.test(employeeId))fail('Choose a card and a driver.');
  const card=(await pool.query(CARD_SQL,[logbookId,OPERATIONAL_START])).rows[0];
  if(!card)fail('This card is no longer saved.',404);
  requireLogBookSite(scope,card.site);
  const employee=(await pool.query(EMPLOYEE_SQL,[employeeId,EMPLOYEE_LISTS])).rows[0],kind=card.book_type==='equipment'?'equipment':'vehicle';
  const refusal=pickRefusal(employee?.record_data,{site:card.site,date:card.date,kind});
  if(refusal)fail(refusal,409);
  const data=card.data||{},identity=employeeIdentity(employee.record_data),name=text(employee.record_data.name||employee.record_data.employee);
  // The same person as on the card: nothing to correct. Typing the saved driver's own number from the paper card is
  // the same answer as "This card is right", so a card listed for its FORM A box is confirmed and leaves the list.
  // (After a helper's "Yes" or an approved site move the card passes the re-check by itself.)
  if(String(data.employeeId??'')===String(employee.id)){
   await pool.query(CANCEL_PICK_SQL,[card.id]);
   const outcome=await confirmSaved(req,card);
   return res.json({same:true,pick:null,confirmed:outcome.confirmed});
  }
  const masters=(await readMasters(pool)).rows;
  const verdict=recheckSavedCard(masters,{kind:card.book_type,site:card.site,date:card.date,employeeId:data.employeeId,caliberId:data.caliberId,aFormNo:data.aFormNo});
  // Submit changes the card at once, so it changes only a card that is on the list: one whose driver stands is not
  // this page's to change. (A card just corrected by someone else, or pressed twice, ends here too.)
  if(!verdict)fail('Card '+card.book_no+' is not on the list: its '+(kind==='equipment'?'operator':'driver')+' stands at this site on this date. Nothing was changed.',409);
  const by=login(req),byName=nameOf(req),at=new Date().toISOString();
  // One step (owner, 23 Nov 2026): the choice and the correction are one transaction. A refusal (the card changed
  // meanwhile, the driver already holds another card of this vehicle and shift) leaves nothing behind and goes back
  // to the card's line, where the person with the paper card reads it.
  const done=await transaction(async client=>{
   await client.query(CANCEL_PICK_SQL,[card.id]);
   // Another driver is chosen: an earlier "This card is right" no longer stands.
   await client.query(WITHDRAW_SQL,[card.id,by]);
   const pick=(await client.query('INSERT INTO mis_caliber_corrections(logbook_id,book_no,book_type,book_date,site,reason,old_employee_id,old_caliber_id,old_name,new_employee_id,new_caliber_id,new_name,picked_by,picked_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *',
    [card.id,card.book_no,card.book_type,card.date,card.site,verdict?.reason||'',text(data.employeeId),text(data.caliberId),text(data.employeeName),String(employee.id),identity.employeeId,name,by,byName])).rows[0];
   const result=await applyCaliberCorrection(client,pick,{by,byName,at});
   if(result.refused)fail(result.refused,409);
   // The card as it is now, judged again. The chosen driver stands on every count a person can answer for; when
   // only the FORM A box still points at a colleague, the number typed from the paper card is the same answer as
   // "This card is right", so the card leaves the list. Anything else (the number on two people) is said.
   const after=recheckSavedCard(masters,{kind:card.book_type,site:card.site,date:card.date,employeeId:String(employee.id),caliberId:identity.employeeId,aFormNo:data.aFormNo});
   const settles=canConfirmSaved(after);
   if(settles)await client.query('INSERT INTO mis_caliber_confirmed_cards(logbook_id,book_no,book_type,book_date,site,reason,employee_id,caliber_id,name,a_form,named_id,named_name,confirmed_by,confirmed_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
    [card.id,card.book_no,card.book_type,card.date,card.site,after.reason,String(employee.id),identity.employeeId,name,text(data.aFormNo),text(after.aForm?.id),text(after.aForm?.name),by,byName]);
   return {id:String(pick.id),still:after&&!settles?after.line:''};
  });
  req.audit={eventType:'Log book',module:'Caliber ID re-check',action:'Correct the driver',targetType:'Log book',targetReference:card.book_no,details:{from:text(data.caliberId),fromName:text(data.employeeName),to:identity.employeeId,toName:name,site:card.site,date:card.date,correction:done.id}};
  res.status(201).json({same:false,pick:null,corrected:true,still:done.still,correction:{id:done.id,bookNo:card.book_no,from:text(data.caliberId),fromName:text(data.employeeName),to:identity.employeeId,toName:name}});
 }));

 // Undo of a correction: the earlier person goes back on the card. The same people and sites as choosing the driver.
 app.delete('/api/caliber-recheck/correction/:id',...protect,wrap(async(req,res)=>{
  const scope=await getSiteScope(req.session);
  if(!/^\d{1,18}$/.test(req.params.id))fail('Choose a correction.');
  const correction=(await pool.query("SELECT id,logbook_id,book_no,site,book_date,new_employee_id FROM mis_caliber_corrections WHERE id=$1 AND status='applied'",[req.params.id])).rows[0];
  if(!correction)return res.json({removed:false});
  requireLogBookSite(scope,correction.site);
  const outcome=await transaction(async client=>{
   const result=await undoCaliberCorrection(client,correction,{by:login(req),byName:nameOf(req)});
   if(result.refused)fail(result.refused,409);
   return result;
  });
  req.audit={eventType:'Log book',module:'Caliber ID re-check',action:'Take back the correction',targetType:'Log book',targetReference:outcome.bookNo,details:{from:outcome.from,fromName:outcome.fromName,to:outcome.to,toName:outcome.toName,site:correction.site,date:correction.book_date,correction:String(correction.id)}};
  res.json({removed:true,card:{bookNo:outcome.bookNo,employeeId:outcome.to,name:outcome.toName}});
 }));

 app.delete('/api/caliber-recheck/pick/:logbookId',...protect,wrap(async(req,res)=>{
  const scope=await getSiteScope(req.session);
  if(!/^\d{1,18}$/.test(req.params.logbookId))fail('Choose a card.');
  const pick=(await pool.query("SELECT id,site,book_no FROM mis_caliber_corrections WHERE logbook_id=$1 AND status='pending'",[req.params.logbookId])).rows[0];
  if(!pick)return res.json({removed:false});
  requireLogBookSite(scope,pick.site);
  await pool.query("UPDATE mis_caliber_corrections SET status='cancelled' WHERE id=$1 AND status='pending'",[pick.id]);
  res.json({removed:true});
 }));

 app.post('/api/caliber-recheck/confirm',...protect,wrap(async(req,res)=>{
  const scope=await getSiteScope(req.session),logbookId=text(req.body?.logbookId);
  if(!/^\d{1,18}$/.test(logbookId))fail('Choose a card.');
  const card=(await pool.query(CARD_SQL,[logbookId,OPERATIONAL_START])).rows[0];
  if(!card)fail('This card is no longer saved.',404);
  requireLogBookSite(scope,card.site);
  const outcome=await confirmSaved(req,card);
  if(outcome.refused)fail(outcome.refused,409);
  res.status(outcome.confirmed?201:200).json(outcome);
 }));

 // Takes a "This card is right" back: the card is judged afresh and listed again.
 app.delete('/api/caliber-recheck/confirm/:logbookId',...protect,wrap(async(req,res)=>{
  const scope=await getSiteScope(req.session);
  if(!/^\d{1,18}$/.test(req.params.logbookId))fail('Choose a card.');
  const row=(await pool.query("SELECT id,site,book_no FROM mis_caliber_confirmed_cards WHERE logbook_id=$1 AND status='confirmed'",[req.params.logbookId])).rows[0];
  if(!row)return res.json({removed:false});
  requireLogBookSite(scope,row.site);
  await pool.query(WITHDRAW_SQL,[req.params.logbookId,login(req)]);
  req.audit={eventType:'Log book',module:'Caliber ID re-check',action:'Take back the confirmation',targetType:'Log book',targetReference:row.book_no,details:{site:row.site}};
  res.json({removed:true});
 }));

 // The cards confirmed as right, for HR: which card, which driver stays on it, whom the FORM A box named, who confirmed.
 app.get('/api/caliber-recheck/confirmed',...protect,wrap(async(req,res)=>{
  const scope=await getSiteScope(req.session);
  const {rows}=await pool.query(CONFIRMED_SQL);
  res.json({confirmed:rows.filter(row=>siteAllowed(scope,row.site)).map(row=>({id:String(row.id),logbookId:String(row.logbook_id),bookNo:row.book_no,book:kindLabel(row.book_type),date:row.book_date,site:displaySiteName(row.site)||row.site,
   driver:row.caliber_id,driverName:row.name,formA:row.a_form,namedId:row.named_id,namedName:row.named_name,by:row.confirmed_name||row.confirmed_by,at:row.confirmed_at}))});
 }));

 // The correction run. Every waiting pick the login may see is put on its card; one that no longer holds stays waiting with the reason.
 app.post('/api/caliber-recheck/apply',...protect,wrap(async(req,res)=>{
  if(!isMisAdministrator(req.session))fail('Only an MIS administrator can run the corrections.',403);
  const scope=await getSiteScope(req.session);
  const waiting=(await pool.query("SELECT * FROM mis_caliber_corrections WHERE status='pending' ORDER BY book_date,id")).rows.filter(row=>siteAllowed(scope,row.site));
  const by=login(req),byName=nameOf(req),at=new Date().toISOString(),applied=[],refused=[];
  for(const pick of waiting){
   const outcome=await transaction(async client=>{
    const live=(await client.query("SELECT * FROM mis_caliber_corrections WHERE id=$1 AND status='pending' FOR UPDATE",[pick.id])).rows[0];
    if(!live)return {skipped:true};
    const result=await applyCaliberCorrection(client,live,{by,byName,at});
    if(result.refused)await client.query('UPDATE mis_caliber_corrections SET note=$2 WHERE id=$1',[live.id,result.refused.slice(0,400)]);
    return result;
   });
   if(outcome.applied)applied.push({bookNo:outcome.bookNo,from:outcome.from,to:outcome.to});
   else if(outcome.refused)refused.push({bookNo:pick.book_no,why:outcome.refused});
  }
  req.audit={eventType:'Log book',module:'Caliber ID re-check',action:'Run the corrections',targetType:'Log book',targetReference:applied.length+' cards',details:{applied:applied.length,refused:refused.length,cards:applied.slice(0,200)}};
  res.json({applied:applied.length,refused,waiting:waiting.length});
 }));

 app.get('/api/caliber-recheck/record',...protect,wrap(async(req,res)=>{
  const scope=await getSiteScope(req.session);
  const {rows}=await pool.query(RECORD_SQL);
  res.json({corrections:rows.filter(row=>siteAllowed(scope,row.site)).map(row=>({id:String(row.id),logbookId:String(row.logbook_id),bookNo:row.book_no,book:kindLabel(row.book_type),date:row.book_date,site:displaySiteName(row.site)||row.site,reason:RECHECK_REASONS[row.reason]||'',
   from:row.old_caliber_id,fromName:row.old_name,to:row.new_caliber_id,toName:row.new_name,pickedBy:row.picked_name||row.picked_by,pickedAt:row.picked_at,appliedBy:row.applied_name||row.applied_by,appliedAt:row.applied_at}))});
 }));
}
