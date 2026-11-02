import React,{useEffect,useRef,useState} from 'react';
import EquipmentAliasOtpPanel,{aliasApi} from './equipment-alias-otp-panel.jsx';
import {aliasForSelection} from '../equipment-alias-rules.mjs';
import {searchSiteDoors,doorLabel} from './door-search.mjs';
import {canonicalSiteName} from '../site-location.mjs';

// Manual VLB / ELB entry: the operator typed a machine the Pulse master does not list at this
// site. Pair it with one Pulse record; the card continues with that record at once and the
// alias becomes permanent after the OTP (or at once when the OTP rule is off).
export default function ManualAliasDialog({session,kind,written,site,assets=[],otpEnabled,onPaired,onDismiss}){
 const dialog=useRef(null),[choice,setChoice]=useState(''),[alias,setAlias]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[settings,setSettings]=useState(null);
 useEffect(()=>{const node=dialog.current;if(node&&!node.open)node.showModal();return()=>{if(node?.open)node.close()}},[]);
 useEffect(()=>{let active=true;aliasApi(session)('/api/equipment-aliases/settings').then(data=>{if(active)setSettings(data)}).catch(()=>{});return()=>{active=false}},[session?.token]);
 const atSite=searchSiteDoors(assets,kind,site).filter(a=>canonicalSiteName(a.site||a.currentLocation||a.location)===canonicalSiteName(site));
 const number=value=>Number((String(value).match(/\d+/)||[0])[0]),target=number(written);
 const ranked=[...atSite].sort((a,b)=>Math.abs(number(a.door)-target)-Math.abs(number(b.door)-target));
 const chosen=atSite.find(a=>String(a.id)===choice);
 const pair=async()=>{
  if(!chosen||busy)return;setBusy(true);setError('');
  try{
   const request=aliasForSelection(written,chosen,kind);
   if(!request){setError(written+' already matches '+doorLabel(chosen)+'. Select it from the list instead.');return;}
   const result=await aliasApi(session)('/api/equipment-aliases',{...request,site,book:kind==='vehicle'?'vlb':'elb'});
   if(!result.alias){await onPaired?.(chosen);return;}
   setAlias(result.alias);
   if(result.alias.status==='active'||!otpEnabled)await onPaired?.(chosen);
  }catch(e){setError(e.message)}finally{setBusy(false)}
 };
 return <dialog ref={dialog} className="scan-equipment-dialog scan-alias-dialog" aria-labelledby="manual-alias-title" onCancel={event=>{event.preventDefault();onDismiss?.()}}>
  <h2 id="manual-alias-title">Written machine not in Pulse</h2>
  <p><strong>{written}</strong> is not a door of any {kind==='vehicle'?'tipper':'machine'} at {site||'the selected site'}. Pair it with the Pulse record it stands for. The card continues with that record now; the pair becomes a permanent alias {otpEnabled?'after the OTP':'at once'}.</p>
  {!alias&&<><ul className="scan-alias-list">{ranked.map((a,i)=><li key={a.id} className={i===0?'scan-alias-suggested':''}><label><input type="radio" name="manual-alias-choice" disabled={busy} checked={choice===String(a.id)} onChange={()=>setChoice(String(a.id))}/> <strong>{doorLabel(a)}</strong>{i===0?<em> suggested by number</em>:null}</label></li>)}{!ranked.length&&<li>No Pulse {kind==='vehicle'?'tippers':'machines'} at this site.</li>}</ul>
   <div className="vlb-batch-actions"><button type="button" className="vlb-approval-primary" disabled={busy||!chosen} onClick={pair}>{busy?'Pairing…':otpEnabled?'Pair and continue to OTP':'Pair and save alias'}</button></div></>}
  {alias&&alias.status!=='active'&&otpEnabled&&<><p className="scan-alias-pair">Pair: <strong>{doorLabel(chosen)}</strong> ⇄ <strong>{written}</strong> · applied to this card</p><EquipmentAliasOtpPanel session={session} alias={alias} site={site} approver={settings?.approver||null} approverTelegramLinked={settings?settings.approverTelegramLinked:true} onAlias={setAlias} onApproved={async()=>{await onPaired?.(chosen);}}/></>}
  {alias&&alias.status==='active'&&<p role="status" className="vlb-approval-feedback">Approved. {written} now maps to {doorLabel(chosen)}.</p>}
  {error&&<p role="alert" className="logbook-message error">{error}</p>}
  <footer><button type="button" disabled={busy} onClick={()=>{if(alias&&chosen)void onPaired?.(chosen);else onDismiss?.();}}>{alias?'Continue with the card':'Cancel'}</button></footer>
 </dialog>;
}
