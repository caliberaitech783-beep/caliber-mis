import React,{useEffect,useState} from 'react';
import {displaySiteName} from '../region-scope.mjs';

export const holdRoleLabels={vlb_door:'VLB vehicle',vlb_loader:'VLB loading machine',elb_door:'ELB machine'};
export const holdRoles=(roles=[])=>roles.map(role=>holdRoleLabels[role]||role).join(', ');
export const otpCountdown=(expiresAt,now=Date.now())=>{
 const remaining=Math.floor((new Date(expiresAt).getTime()-now)/1000);
 if(!Number.isFinite(remaining))return '';
 if(remaining<=0)return 'expired';
 return `${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')} left`;
};
export const otpSentText=otp=>{
 const count=otp?.sentTo?.length||0,channels=(otp?.channels||[]).map(channel=>channel==='telegram'?'Telegram':channel==='whatsapp'?'WhatsApp':channel).join(' / ');
 return `OTP sent to ${count} PM${count===1?'':'s'}${channels?' via '+channels:''}`;
};
const callApi=async(session,url,body)=>{
 const response=await fetch(url,{method:'POST',cache:'no-store',headers:{Authorization:'Bearer '+session.token,'Content-Type':'application/json'},body:JSON.stringify(body)});
 let data={};try{data=await response.json()}catch{data={}}
 if(!response.ok)throw Error(data.error||(response.status===404||response.status===503?'Express OTP approval is not available on this server yet (HTTP '+response.status+'). Use the Vehicle transfers workflow.':'Request failed (HTTP '+response.status+').'));
 return data;
};
const useClock=active=>{const [now,setNow]=useState(()=>Date.now());useEffect(()=>{if(!active)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[active]);return now};

// One row per held asset: the current master site, the cards and trips waiting on it, and the
// express transfer OTP controls. The hold itself clears when the server re-reads the master.
export default function VlbBatchHolds({session,batch,onChanged}){
 const holds=batch?.holds||[];
 const [rows,setRows]=useState({});
 const now=useClock(Object.values(rows).some(row=>row.otp&&!row.completed));
 if(!holds.length)return null;
 const patch=(assetId,value)=>setRows(current=>({...current,[assetId]:{...current[assetId],...value}}));
 const request=async hold=>{
  patch(hold.assetId,{busy:true,error:''});
  try{const data=await callApi(session,'/api/vehicle-transfers/express',{batchId:batch.id,assetId:hold.assetId});patch(hold.assetId,{busy:false,otp:data.otp,transfer:data.transfer,code:''})}
  catch(e){patch(hold.assetId,{busy:false,error:e.message})}
 };
 const verify=async hold=>{
  const row=rows[hold.assetId]||{};if(!row.otp?.id)return;
  patch(hold.assetId,{busy:true,error:''});
  try{const data=await callApi(session,'/api/vehicle-transfers/express/'+row.otp.id+'/verify',{otp:String(row.code||'').trim()});patch(hold.assetId,{busy:false,completed:true,transfer:data.transfer||row.transfer});onChanged?.(data)}
  catch(e){patch(hold.assetId,{busy:false,error:e.message})}
 };
 return <section className="logbook-section vlb-batch-holds" aria-label="Awaiting transfer"><h2>Awaiting transfer</h2>
  <p>These assets are booked at another site in the Equipment master. Lock VLB and Close batch stay blocked until each transfer completes. Express transfer sends a release OTP to the source site PM.</p>
  <div className="logbook-table-wrap"><table className="logbook-table"><thead><tr><th>Asset</th><th>Current site</th><th>Cards</th><th>Trips</th><th>Named as</th><th>Transfer</th></tr></thead><tbody>
   {holds.map(hold=>{const row=rows[hold.assetId]||{};const expired=row.otp&&otpCountdown(row.otp.expiresAt,now)==='expired';
    return <tr key={hold.assetId}><td>{hold.label||hold.assetId}</td><td>{displaySiteName(hold.assetSite)||'No site'}</td><td>{hold.cardCount??hold.cards?.length??0}</td><td>{hold.trips??0}</td><td>{holdRoles(hold.roles)||'—'}</td>
     <td>{row.completed?<span role="status">Transfer {row.transfer?.transferNo||''} completed. The hold clears on the next batch refresh.</span>:<>
      {!row.otp&&<button type="button" disabled={row.busy} onClick={()=>request(hold)}>{row.busy?'Sending…':'Express transfer (OTP)'}</button>}
      {row.otp&&<div className="vlb-hold-otp"><span role="status">{row.transfer?.transferNo?'Transfer '+row.transfer.transferNo+' · ':''}{otpSentText(row.otp)} · {otpCountdown(row.otp.expiresAt,now)}</span>
       <label>OTP<input type="text" inputMode="numeric" maxLength={6} aria-label={'OTP for '+(hold.label||hold.assetId)} value={row.code||''} disabled={row.busy||expired} onChange={e=>patch(hold.assetId,{code:e.target.value})}/></label>
       <button type="button" disabled={row.busy||expired||String(row.code||'').trim().length<4} onClick={()=>verify(hold)}>{row.busy?'Verifying…':'Verify'}</button>
       {expired&&<button type="button" disabled={row.busy} onClick={()=>request(hold)}>Resend OTP</button>}</div>}
      {row.error&&<p className="logbook-message error" role="alert">{row.error}</p>}
     </>}</td></tr>})}
  </tbody></table></div>
 </section>;
}

export const equipmentCategories=['Vehicle','Equipment'];
const blankDraft={door:'',category:'Equipment',equipmentName:'',make:'',model:'',registration:'',chassis:''};

// Short form for an asset that exists at no site yet. The site is fixed to the batch site; the
// server sends the OTP to this site's PM and creates the master record on verification.
export function NewEquipmentRequest({session,batch,initialDraft,onCreated,onDismiss}){
 const [draft,setDraft]=useState(()=>({...blankDraft,...(initialDraft||{})}));
 const [request,setRequest]=useState(null),[code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[created,setCreated]=useState(null);
 const now=useClock(Boolean(request&&!created));
 const update=(key,value)=>{setDraft(current=>({...current,[key]:value}));setError('')};
 const ready=draft.door.trim()&&(draft.registration.trim()||draft.chassis.trim());
 const send=async()=>{
  if(!ready){setError('Enter the door number and either the registration or the chassis number.');return}
  setBusy(true);setError('');
  try{const data=await callApi(session,'/api/equipment/express',{batchId:batch.id,draft:{...draft,site:batch.site}});setRequest(data.request)}
  catch(e){setError(e.message)}finally{setBusy(false)}
 };
 const verify=async()=>{
  if(!request?.id)return;setBusy(true);setError('');
  try{const data=await callApi(session,'/api/equipment/express/'+request.id+'/verify',{otp:code.trim()});setCreated(data.equipment||{door:draft.door});onCreated?.(data)}
  catch(e){setError(e.message)}finally{setBusy(false)}
 };
 const expired=request&&otpCountdown(request.expiresAt,now)==='expired';
 return <section className="logbook-section vlb-new-equipment" aria-label="Create new equipment"><div className="logbook-section-title"><h2>Create new equipment</h2><span>Site: {displaySiteName(batch.site)}</span></div>
  {created?<p role="status">{created.door||draft.door} has been created in the Equipment master at {displaySiteName(batch.site)}. It joins this batch on the next refresh.</p>:<>
   <p>For an asset that exists at no site yet. Registration or chassis number is mandatory; the site PM receives the approval OTP.</p>
   <div className="logbook-fields vlb-fleet-fields">
    <label className="logbook-field"><span>Door number *</span><input type="text" value={draft.door} disabled={busy||Boolean(request)} onChange={e=>update('door',e.target.value)}/></label>
    <label className="logbook-field"><span>Category</span><select value={draft.category} disabled={busy||Boolean(request)} onChange={e=>update('category',e.target.value)}>{equipmentCategories.map(c=><option key={c}>{c}</option>)}</select></label>
    <label className="logbook-field"><span>Equipment name</span><input type="text" value={draft.equipmentName} disabled={busy||Boolean(request)} onChange={e=>update('equipmentName',e.target.value)}/></label>
    <label className="logbook-field"><span>Make</span><input type="text" value={draft.make} disabled={busy||Boolean(request)} onChange={e=>update('make',e.target.value)}/></label>
    <label className="logbook-field"><span>Model</span><input type="text" value={draft.model} disabled={busy||Boolean(request)} onChange={e=>update('model',e.target.value)}/></label>
    <label className="logbook-field"><span>Registration</span><input type="text" value={draft.registration} disabled={busy||Boolean(request)} onChange={e=>update('registration',e.target.value)}/></label>
    <label className="logbook-field"><span>Chassis</span><input type="text" value={draft.chassis} disabled={busy||Boolean(request)} onChange={e=>update('chassis',e.target.value)}/></label>
    <label className="logbook-field"><span>Site</span><input type="text" value={displaySiteName(batch.site)} readOnly/></label>
   </div>
   {request&&<div className="vlb-hold-otp"><span role="status">{otpSentText(request)} · {otpCountdown(request.expiresAt,now)}</span><label>OTP<input type="text" inputMode="numeric" maxLength={6} aria-label="New equipment OTP" value={code} disabled={busy||expired} onChange={e=>setCode(e.target.value)}/></label></div>}
   <div className="vlb-batch-actions">{onDismiss&&<button type="button" disabled={busy} onClick={onDismiss}>Cancel</button>}{!request||expired?<button type="button" className="vlb-approval-primary" disabled={busy} onClick={send}>{busy?'Sending…':request?'Resend OTP':'Send OTP request'}</button>:<button type="button" className="vlb-approval-primary" disabled={busy||code.trim().length<4} onClick={verify}>{busy?'Verifying…':'Verify'}</button>}</div>
   {error&&<p className="logbook-message error" role="alert">{error}</p>}
  </>}
 </section>;
}
