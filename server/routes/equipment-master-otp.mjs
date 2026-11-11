// Two-way Equipment master. Pulse (pulse.cmll.in) keeps the master; Pulse-II reads it through the
// one-minute master sync. An add, edit or delete made in Pulse-II is sent to Pulse as one change
// set; Pulse sends one shared OTP to the authorised mobiles and applies the set only after that
// OTP is entered. Pulse-II then pulls the Equipment master at once, so both sites match.
export const EQUIPMENT_MASTER='Equipment master';
const fail=(message,status=400,code)=>{throw Object.assign(new Error(message),{status,code});};
const isWrite=req=>!['GET','HEAD','OPTIONS'].includes(req.method);

// Pulse-II record ids are local; Pulse knows its own ids. Edits and deletes are translated
// through pulse_master_links, and a record Pulse does not have is refused rather than guessed.
export async function toPulseChanges(pool,changes){
 if(!Array.isArray(changes)||!changes.length)fail('Add, edit or delete at least one equipment record before requesting the OTP.');
 const localIds=[...new Set(changes.filter(change=>change?.operation!=='add').map(change=>Number(change?.id)).filter(id=>Number.isSafeInteger(id)&&id>0))];
 const links=new Map();
 if(localIds.length){
  const {rows}=await pool.query('SELECT source_id,local_id FROM pulse_master_links WHERE master_name=$1 AND local_id=ANY($2::bigint[])',[EQUIPMENT_MASTER,localIds]);
  for(const row of rows)links.set(Number(row.local_id),Number(row.source_id));
 }
 return changes.map((change,index)=>{
  const operation=String(change?.operation||'').trim().toLowerCase();
  const {id:_local,...record}=change?.record&&typeof change.record==='object'&&!Array.isArray(change.record)?change.record:{};
  const label=String(change?.label||record.door||record.equipmentName||'').trim().slice(0,120);
  if(operation==='add')return {operation,record,label};
  if(!['edit','delete'].includes(operation))fail(`Change ${index+1}: choose add, edit or delete.`);
  const source=links.get(Number(change.id));
  if(!source)fail(`${label||'Equipment record '+change.id} is not linked to a Pulse record yet. Run Sync all masters, refresh, and try again.`,409);
  return operation==='delete'?{operation,id:source,label}:{operation,id:source,record,label};
 });
}

export function registerEquipmentMasterOtp(app,{pool,pulse,sharedSignIn,requireSuper,audit=()=>{},wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 // Direct writes would be overwritten by the next sync, so every change goes through the OTP.
 app.use('/api/masters/:master',(req,res,next)=>{
  if(isWrite(req)&&decodeURIComponent(req.params.master)===EQUIPMENT_MASTER)
   return res.status(409).json({error:'Equipment master changes need the shared OTP sent to the authorised mobiles.',code:'equipment_otp_required'});
  next();
 });
 const guard=(req,res,next)=>{req.params={...req.params,master:encodeURIComponent(EQUIPMENT_MASTER)};return requireSuper(req,res,next);};
 const respond=fn=>async(req,res,next)=>{
  res.set('Cache-Control','no-store');
  try{res.json(await fn(req));}catch(error){if(error.status)return res.status(error.status).json({error:error.message,...error.code?{code:error.code}:{}});next(error);}
 };
 const actor=req=>req.session?.login||req.session?.username||null;
 // A sync already running finishes first; the one-minute loop covers anything still left.
 const pullFromPulse=async who=>{
  for(let attempt=0;attempt<6;attempt++){
   try{await pulse.sync(EQUIPMENT_MASTER,who);return true;}
   catch(error){if(!/already running/i.test(error.message))return false;await wait(1000);}
  }
  return false;
 };
 app.post('/api/equipment-master/changes',guard,respond(async req=>{
  const changes=await toPulseChanges(pool,req.body?.changes);
  const result=await sharedSignIn.request('equipment-changes',{changes},actor(req));
  audit(req,{action:'Request Equipment master OTP',reference:result?.id,details:result?.summary});
  return result;
 }));
 app.post('/api/equipment-master/changes/:id/verify',guard,respond(async req=>{
  const otp=String(req.body?.otp||'').trim();
  if(!/^\d{6}$/.test(otp))fail('Enter the six-digit OTP.');
  const result=await sharedSignIn.request('equipment-changes-verify',{id:String(req.params.id),otp},actor(req));
  audit(req,{action:'Apply Equipment master changes by OTP',reference:req.params.id,details:result?.summary});
  return {...result,synced:await pullFromPulse(actor(req))};
 }));
}
