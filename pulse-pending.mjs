import {displaySiteName} from './region-scope.mjs';

// Express transfers and express-created assets that reached only Pulse-II (pulseWrite.mode =
// local-only) and still have to be applied in Pulse by hand. This list is the replay queue
// for the day the Pulse integration endpoints go live.
const text=value=>String(value??'').trim();
export const PULSE_PENDING_REMINDER_KEY='pulse_pending_reminder';

export async function listPendingPulseWrites(pool){
 const transfers=(await pool.query(`SELECT id,record_data FROM master_records WHERE master_name='Vehicle transfers' AND record_data->'pulseWrite'->>'mode'='local-only' ORDER BY id`)).rows
  .map(r=>({kind:'transfer',id:String(r.id),reference:text(r.record_data.transferNo),door:text(r.record_data.door||r.record_data.equipment),from:displaySiteName(r.record_data.source),to:displaySiteName(r.record_data.destination),
   approvedBy:text(r.record_data.sourceApprovedBy),requestedBy:text(r.record_data.destinationMisVerifiedLogin||r.record_data.submittedLogin),at:text(r.record_data.sourceApprovedAt||r.record_data.submittedAt),note:text(r.record_data.pulseWrite?.note)}));
 const equipment=(await pool.query(`SELECT id,record_data FROM master_records WHERE master_name='Equipment master' AND record_data->'pulseWrite'->>'mode'='local-only' ORDER BY id`)).rows
  .map(r=>({kind:'equipment',id:String(r.id),reference:text(r.record_data.door),door:text(r.record_data.door),from:'',to:displaySiteName(r.record_data.currentLocation||r.record_data.site),
   approvedBy:text(r.record_data.approvedBy),requestedBy:text(r.record_data.createdBy),at:text(r.record_data.approvedAt||r.record_data.createdAt),note:text(r.record_data.pulseWrite?.note),
   chassis:text(r.record_data.chassis||r.record_data.chassisNo),registration:text(r.record_data.reg||r.record_data.registration),make:text(r.record_data.make),model:text(r.record_data.model||r.record_data.modelNo)}));
 return [...transfers,...equipment].sort((a,b)=>String(a.at).localeCompare(String(b.at))||a.reference.localeCompare(b.reference));
}

export async function markPulseWriteApplied(pool,{kind,id,by,note=''}){
 const master=kind==='transfer'?'Vehicle transfers':kind==='equipment'?'Equipment master':null;
 if(!master||!/^\d+$/.test(String(id)))throw Object.assign(new Error('Invalid pending Pulse item.'),{status:400});
 const {rows}=await pool.query(`UPDATE master_records SET record_data=record_data||jsonb_build_object('pulseWrite',jsonb_build_object('mode','applied-manually','by',$3::text,'at',$4::text,'note',$5::text))
  WHERE id=$1 AND master_name=$2 AND record_data->'pulseWrite'->>'mode'='local-only' RETURNING id`,[id,master,text(by).toLowerCase(),new Date().toISOString(),text(note).slice(0,300)]);
 if(!rows.length)throw Object.assign(new Error('This item is no longer pending in Pulse.'),{status:409});
 return {kind,id:String(id)};
}

export function pendingPulseMessage(items){
 const transfers=items.filter(i=>i.kind==='transfer'),equipment=items.filter(i=>i.kind==='equipment');
 const lines=[`Pulse-II: ${items.length} change${items.length===1?'':'s'} approved by OTP still need${items.length===1?'s':''} to be applied in Pulse.`];
 if(transfers.length)lines.push(`Transfers (${transfers.length}): `+transfers.slice(0,8).map(t=>`${t.door||t.reference} ${t.from} → ${t.to}`).join('; ')+(transfers.length>8?'; …':''));
 if(equipment.length)lines.push(`New assets (${equipment.length}): `+equipment.slice(0,8).map(e=>`${e.door} at ${e.to}`).join('; ')+(equipment.length>8?'; …':''));
 lines.push('Open Pulse-II → Pulse Master Sync → Pending in Pulse, apply each in Pulse, then mark it applied.');
 return lines.join('\n');
}

// Once per India calendar day, at or after 09:00, to the configured Pulse administrators.
export async function remindPendingPulse({pool,telegram,logins=[],nowMs=Date.now()}){
 if(!logins.length||!telegram)return {sent:0,skipped:'no recipients'};
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hour12:false}).formatToParts(new Date(nowMs)).map(p=>[p.type,p.value]));
 const date=`${parts.year}-${parts.month}-${parts.day}`;if(Number(parts.hour)<9)return {sent:0,skipped:'before 09:00'};
 const last=(await pool.query('SELECT setting_value FROM app_settings WHERE setting_key=$1',[PULSE_PENDING_REMINDER_KEY])).rows[0]?.setting_value;
 if(last?.date===date)return {sent:0,skipped:'already sent today'};
 const items=await listPendingPulseWrites(pool);
 if(!items.length)return {sent:0,skipped:'nothing pending'};
 const message=pendingPulseMessage(items);let sent=0;
 for(const login of logins){try{if(await telegram.send(login,message,`pulse-pending:${date}:${login}`))sent++;}catch{}}
 await pool.query('INSERT INTO app_settings(setting_key,setting_value,updated_at) VALUES($1,$2::jsonb,NOW()) ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=NOW()',[PULSE_PENDING_REMINDER_KEY,JSON.stringify({date,sent,items:items.length})]);
 return {sent,items:items.length};
}

export function registerPulsePending(app,{pool,requireSession,requireAdministrator,writer=null}){
 const guard=[requireSession,requireAdministrator];
 app.get('/api/pulse-pending',...guard,async(req,res,next)=>{try{req.audit=false;res.set('Cache-Control','no-store').json({mode:writer?.mode?.()||'off',items:await listPendingPulseWrites(pool)});}catch(e){next(e);}});
 app.post('/api/pulse-pending/:kind/:id/applied',...guard,async(req,res,next)=>{try{
  const result=await markPulseWriteApplied(pool,{kind:req.params.kind,id:req.params.id,by:req.session.login||req.session.name,note:req.body?.note});
  req.audit={eventType:'Master data',module:'Pulse Master Sync',action:'Mark express change applied in Pulse',targetType:req.params.kind==='transfer'?'Vehicle transfer':'Equipment',targetReference:String(req.params.id),changedFields:[],details:{note:text(req.body?.note)}};
  res.json(result);
 }catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}});
}
