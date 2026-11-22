import React,{useEffect,useRef,useState} from 'react';
import EquipmentAliasOtpPanel,{aliasApi} from './equipment-alias-otp-panel.jsx';
import {formatDisplayDateTime} from '../shared/date-time-format.mjs';
import TableSmartPrint from './table-smart-print.jsx';
import {sameSite,siteChoices} from '../shared/report-filter-options.mjs';
import {SortableHeader,sortRowsBlanksLast} from './sortable-table.jsx';
import SmartSearchReport from './smart-search-report.jsx';

// Equipment master overlay: the ALIAS column, the revoke dialog (same two OTP routes as
// approval) and the administrator list per site with full history and the approver setting.
export const aliasStatusLabel={pending:'Pending approval',active:'Active',suspended:'Suspended',retired:'Retired',revoked:'Revoked'};
export const aliasRouteLabel=alias=>alias.approvalRoute==='nitish'?'approved by the mapping approver':alias.approvalRoute==='site_pm'?'approved by the site PM (emergency: '+(alias.emergencyReason||'')+')':alias.approvalRoute==='reviewer'?'saved on the reviewer\'s choice':'';
export const aliasHover=alias=>[aliasStatusLabel[alias.status]||alias.status,aliasRouteLabel(alias),alias.approvedBy?'by '+alias.approvedBy:'',alias.approvedAt?formatDisplayDateTime(alias.approvedAt):alias.createdAt?formatDisplayDateTime(alias.createdAt):'',alias.suspendedReason||''].filter(Boolean).join(' · ');

export function useEquipmentAliases(token,{all=false}={}){
 const [data,setData]=useState({aliases:[],otpEnabled:false,approver:null,approverTelegramLinked:true}),[error,setError]=useState('');
 const refresh=async()=>{try{const response=await fetch('/api/equipment-aliases'+(all?'?all=1':''),{cache:'no-store',headers:{Authorization:'Bearer '+token}});const body=await response.json();if(!response.ok)throw Error(body.error||'Equipment aliases unavailable.');setData(body);setError('');return body;}catch(e){setError(e.message);return null;}};
 useEffect(()=>{if(token)void refresh();},[token,all]);
 return {...data,error,refresh};
}
export const aliasesFor=(aliases,record)=>(aliases||[]).filter(a=>String(a.equipmentId)===String(record?.id)&&['pending','active','suspended'].includes(a.status));

export function EquipmentAliasCell({aliases,record,onRevoke,canRevoke}){
 const rows=aliasesFor(aliases,record);
 if(!rows.length)return <td className="equipment-alias-cell">—</td>;
 return <td className="equipment-alias-cell">{rows.map(alias=><span key={alias.id} className={'equipment-alias equipment-alias-'+alias.status} title={aliasHover(alias)}>{alias.writtenText}{alias.status!=='active'?' ('+aliasStatusLabel[alias.status]+')':''}{canRevoke&&alias.status!=='revoked'&&<button type="button" className="equipment-alias-revoke" aria-label={'Revoke alias '+alias.writtenText} onClick={event=>{event.stopPropagation();onRevoke(alias)}}>×</button>}</span>)}</td>;
}

export function EquipmentAliasRevokeDialog({session,alias,otpEnabled,approver,approverTelegramLinked,onDone,onDismiss}){
 const dialog=useRef(null),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[current,setCurrent]=useState(alias);
 useEffect(()=>{const node=dialog.current;if(node&&!node.open)node.showModal();return()=>{if(node?.open)node.close()}},[]);
 const direct=async()=>{setBusy(true);setError('');try{await aliasApi(session)('/api/equipment-aliases/'+alias.id,{reason},'DELETE');await onDone?.();onDismiss?.();}catch(e){setError(e.message)}finally{setBusy(false)}};
 return <dialog ref={dialog} className="scan-equipment-dialog scan-alias-dialog" aria-labelledby="alias-revoke-title" onCancel={event=>{event.preventDefault();onDismiss?.()}}><div className="mis-popup-close-bar"><button type="button" className="mis-popup-close" onClick={onDismiss}  aria-label="Close window">× Close</button></div>
  <h2 id="alias-revoke-title">Revoke equipment alias</h2>
  <p>Written <strong>{alias.writtenText}</strong> currently maps to <strong>{alias.equipmentDoor||'equipment '+alias.equipmentId}</strong>{alias.equipmentSite?' at '+alias.equipmentSite:''}. Revoking stops the written label resolving on new cards. Saved logbooks are not changed.</p>
  <p className="scan-alias-note">{aliasHover(alias)}</p>
  {otpEnabled?<EquipmentAliasOtpPanel session={session} alias={current} purpose="revoke_alias" site={alias.equipmentSite||alias.site} approver={approver} approverTelegramLinked={approverTelegramLinked} onAlias={setCurrent} onApproved={async()=>{await onDone?.();onDismiss?.();}}/>
  :<><label>Reason (optional)<input type="text" maxLength={300} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="vlb-batch-actions"><button type="button" className="vlb-approval-primary" disabled={busy} onClick={direct}>{busy?'Revoking…':'Revoke alias'}</button></div></>}
  {error&&<p className="logbook-message error" role="alert">{error}</p>}
  <footer><button type="button" onClick={onDismiss}>Close</button></footer>
 </dialog>;
}

// All-site letter rules: learnt from approved aliases whose written number equals the Pulse
// door number, applied by every site's scan engine. A real door or a saved alias at the site
// always wins, and two machines answering one written label go to review.
export function EquipmentLetterRules({rules=[]}){
 return <div className="equipment-letter-rules"><h3>All-site letter rules</h3>
  <p className="scan-alias-note">An approved mapping such as written L21 → DEMO21 also teaches that written L## means DEMO## at every site. A machine that already carries the written label at a site always wins, and a label that matches two machines is held for review.</p>
  {rules.length>0&&<TableSmartPrint row title="Equipment aliases · All-site letter rules"/>}
  <table className="equipment-alias-table"><thead><tr><th>Written letter</th><th>Pulse letter</th><th>Learnt from</th><th>Note</th></tr></thead>
   <tbody>{rules.length?rules.map(rule=><tr key={rule.id}><td>{rule.writtenCode}##</td><td>{rule.targetPrefix}##</td><td>{rule.sources.map(s=><span key={s.aliasId} className="equipment-letter-rule-source">{s.writtenText} → {s.door||'equipment '+s.equipmentId}{s.site?' ('+s.site+')':''}</span>)}</td><td>{rule.kind==='vehicle'?'Tipper header':'Equipment'}{rule.conflicts?.length?' · also '+rule.writtenCode+' → '+rule.conflicts.join(', ')+': both are checked, a double match goes to review':''}</td></tr>):<tr><td colSpan="4" className="empty-state">No all-site letter rules yet. They appear when an approved mapping keeps the number and changes only the letter.</td></tr>}</tbody></table>
 </div>;
}

// The alias list's headings sort it (When by date and time); History and the revoke buttons do not sort.
const aliasColumns=[['written','Written'],['record','Pulse record'],['site','Site'],['status','Status'],['route','Route'],['requestedBy','Requested by'],['when','When']];
const aliasReportColumns=({open,setOpen,aliasActions})=>[
 ...aliasColumns.map(([key,label])=>({key,label,blanksLast:true,value:a=>key==='when'?formatDisplayDateTime(a.approvedAt||a.createdAt):aliasSortValue(a,key),sortValue:a=>aliasSortValue(a,key),
  render:key==='written'?a=><>{a.writtenText}<br/><small>{a.writtenKey}</small></>:key==='record'?a=><>{a.equipmentDoor||a.equipmentId}{a.equipmentName&&a.equipmentName!==a.equipmentDoor?<><br/><small>{a.equipmentName}</small></>:null}</>
  :key==='status'?a=><span title={aliasHover(a)}>{aliasStatusLabel[a.status]||a.status}{a.suspendedReason?<><br/><small>{a.suspendedReason}</small></>:null}</span>:key==='route'?a=><>{aliasRouteLabel(a)}{a.approvedBy?<><br/><small>{a.approvedBy}</small></>:null}</>:undefined})),
 {key:'history',label:'History',value:a=>(a.history||[]).length+' event(s)',render:a=><button type="button" aria-expanded={open===a.id} onClick={()=>setOpen(open===a.id?null:a.id)}>{(a.history||[]).length} event(s)</button>},
 {key:'actions',label:'Action',value:()=>'',render:aliasActions},
];
function aliasSortValue(a={},key){
 if(key==='written')return a.writtenText||'';
 if(key==='record')return String(a.equipmentDoor||a.equipmentId||'');
 if(key==='site')return a.equipmentSite||a.site||'';
 if(key==='status')return aliasStatusLabel[a.status]||a.status||'';
 if(key==='route')return aliasRouteLabel(a);
 if(key==='requestedBy')return a.requestedBy||'';
 if(key==='when'){const time=Date.parse(a.approvedAt||a.createdAt||'');return Number.isNaN(time)?'':time;}
 return '';
}

// Mappings saved before the same-number rule (23 Nov 2026) whose written number is not the
// machine's own number. An administrator sees them in the list below (search, sort, print and
// Excel work as for any other mapping) and removes them in one action.
function NumberMismatchCleanup({session,otpEnabled,shown,onList,onRemoved}){
 const [list,setList]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[sure,setSure]=useState(false);
 const load=async()=>{setBusy(true);setError('');setNotice('');setSure(false);try{const data=await aliasApi(session)('/api/equipment-aliases/number-mismatch');setList(data);onList?.(new Set((data.aliases||[]).map(a=>a.id)));}catch(e){setError(e.message)}finally{setBusy(false)}};
 const remove=async()=>{if(!list?.count||busy)return;setBusy(true);setError('');try{const result=await aliasApi(session)('/api/equipment-aliases/number-mismatch/revoke',{expected:list.count});setNotice(result.revoked+' mapping(s) removed. Cards already saved are not changed.');setList({count:0,aliases:[]});setSure(false);onList?.(null);await onRemoved?.();}catch(e){setError(e.message)}finally{setBusy(false)}};
 return <div className="equipment-alias-number-cleanup"><h3>Mappings where the number differs</h3>
  <p className="scan-alias-note">A mapping is another name for the same machine number (card L21, Pulse DEMO21). A pair with a different number (card T658, machine TPC65) is a corrected reading: from 23 Nov 2026 it applies to that card only and is not saved. Mappings of that kind saved earlier can be listed and removed here.</p>
  <div className="equipment-alias-filters"><button type="button" disabled={busy} onClick={load}>{busy&&!list?'Checking…':list?'Check again':'Show these mappings'}</button>
   {/* One button that changes its words, so Remove never slides under the pointer after a click. */}
   {list&&list.count>0&&<button type="button" disabled={busy} aria-pressed={shown} onClick={()=>onList?.(shown?null:new Set(list.aliases.map(a=>a.id)))}>{shown?'Show all mappings':'Show only these '+list.count}</button>}
   {list&&list.count>0&&!sure&&<button type="button" disabled={busy||otpEnabled} title={otpEnabled?'While the OTP rule is on, each mapping is revoked by OTP.':undefined} onClick={()=>setSure(true)}>Remove these {list.count} mappings…</button>}
   {list&&list.count>0&&sure&&<><strong>Remove {list.count} mappings? They stop working at once.</strong><button type="button" className="vlb-approval-primary" disabled={busy} onClick={remove}>{busy?'Removing…':'Yes, remove '+list.count}</button><button type="button" disabled={busy} onClick={()=>setSure(false)}>Cancel</button></>}</div>
  {list&&list.count>0&&<p role="status">{list.count} mapping(s) have a different number. {shown?'Only they are shown in the list below.':'The list below shows all mappings.'}</p>}
  {list&&!list.count&&!notice&&<p role="status">No mapping has a different number.</p>}
  {error&&<p role="alert" className="logbook-message error">{error}</p>}{notice&&<p role="status" className="vlb-approval-feedback">{notice}</p>}
 </div>;
}

export default function EquipmentAliasAdminPanel({session,isAdmin,ReportSection}){
 const {aliases,letterRules=[],otpEnabled,approver,approverTelegramLinked,error,refresh}=useEquipmentAliases(session?.token,{all:true});
 const [ruleError,setRuleError]=useState('');
 const setAllSites=async(alias,allSites)=>{setRuleError('');try{await aliasApi(session)('/api/equipment-aliases/'+alias.id+'/all-sites',{allSites},'PUT');await refresh();}catch(e){setRuleError(e.message)}};
 const [site,setSite]=useState(''),[status,setStatus]=useState(''),[open,setOpen]=useState(null),[revoke,setRevoke]=useState(null),[login,setLogin]=useState(''),[notice,setNotice]=useState(''),[saveError,setSaveError]=useState('');
 const [aliasSort,setAliasSort]=useState({key:'',direction:'asc'});const changeAliasSort=key=>setAliasSort(current=>({key,direction:current.key===key&&current.direction==='asc'?'desc':'asc'}));
 useEffect(()=>{if(approver?.login)setLogin(approver.login)},[approver?.login]);
 const sites=siteChoices(aliases.map(a=>a.equipmentSite||a.site));
 const aliasActions=a=>isAdmin&&['pending','active','suspended'].includes(a.status)&&<><button type="button" onClick={()=>setRevoke(a)}>Revoke…</button>{a.allSites===false?<button type="button" onClick={()=>setAllSites(a,true)} title="Let this mapping teach its letter rule to every site again">Use at all sites</button>:<button type="button" onClick={()=>setAllSites(a,false)} title="Keep this machine's alias but stop its letter rule at the other sites">This machine only</button>}</>;
 const historyList=a=><ul>{(a.history||[]).map(h=><li key={h.id}>{formatDisplayDateTime(h.at)} · {h.action} · {h.actor}{h.detail&&Object.keys(h.detail).length?' · '+Object.entries(h.detail).filter(([k,v])=>v!==null&&v!==''&&k!=='otpId').map(([k,v])=>k+': '+(Array.isArray(v)?v.join(', '):typeof v==='object'?JSON.stringify(v):v)).join(' · '):''}</li>)}</ul>;
 const [mismatch,setMismatch]=useState(null);
 const rows=aliases.filter(a=>(!site||sameSite(a.equipmentSite||a.site,site))&&(!status||a.status===status)&&(!mismatch||mismatch.has(a.id)));
 const saveApprover=async event=>{event.preventDefault();setSaveError('');setNotice('');try{await aliasApi(session)('/api/equipment-aliases/settings',{approver:{login}},'PUT');await refresh();setNotice('Equipment mapping approver saved.');}catch(e){setSaveError(e.message)}};
 return <section className="panel equipment-alias-admin"><h2>Equipment aliases</h2>
  <p className="scan-alias-note">Written card labels mapped to Pulse records. Approval by OTP is {otpEnabled?'ON':'OFF'} on this server{approver?.login?' · approver '+approver.login.toUpperCase()+(approverTelegramLinked?' (Telegram linked)':' (Telegram NOT linked: only the emergency PM route works)'):''}.</p>
  {error&&<p role="alert" className="logbook-message error">{error}</p>}
  {isAdmin&&<form className="equipment-alias-approver" onSubmit={saveApprover}><label>Equipment mapping approver (MIS login)<input value={login} onChange={e=>setLogin(e.target.value)} aria-label="Equipment mapping approver login"/></label><button type="submit">Save approver</button>{notice&&<span role="status">{notice}</span>}{saveError&&<span role="alert">{saveError}</span>}</form>}
  <EquipmentLetterRules rules={letterRules}/>
  {isAdmin&&<NumberMismatchCleanup session={session} otpEnabled={otpEnabled} shown={Boolean(mismatch)} onList={setMismatch} onRemoved={refresh}/>}
  {ruleError&&<p role="alert" className="logbook-message error">{ruleError}</p>}
  <div className="equipment-alias-filters"><label>Site<select value={site} onChange={e=>setSite(e.target.value)}><option value="">All sites</option>{sites.map(s=><option key={s}>{s}</option>)}</select></label><label>Status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All</option>{Object.entries(aliasStatusLabel).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><button type="button" onClick={refresh}>Refresh</button></div>
  {ReportSection?<SmartSearchReport ReportSection={ReportSection} title={'Equipment aliases · '+(site||'All sites')+(status?' · '+aliasStatusLabel[status]:'')+(mismatch?' · number differs':'')} category="equipment-aliases" description={rows.length+' alias'+(rows.length===1?'':'es')} searchLabel="Smart Search equipment aliases" placeholder="Written label, door, site, status or person" rows={rows} rowKey={a=>a.id} emptyMessage={'No aliases'+(site||status?' match these filters':' yet')+'.'}
   columns={aliasReportColumns({open,setOpen,aliasActions})} rowEditor={(a,colSpan)=>open===a.id&&<tr className="equipment-alias-history"><td colSpan={colSpan}>{historyList(a)}</td></tr>}/>:<>
  {rows.length>0&&<TableSmartPrint row title={'Equipment aliases · '+(site||'All sites')+(status?' · '+aliasStatusLabel[status]:'')+(mismatch?' · number differs':'')}/>}
  <table className="equipment-alias-table"><thead><tr>{aliasColumns.map(([key,label])=><SortableHeader key={key} label={label} sortKey={key} sort={aliasSort} onSort={changeAliasSort} filterIcon={false}/>)}<th>History</th><th></th></tr></thead>
   <tbody>{rows.length?sortRowsBlanksLast(rows,aliasSort,aliasSortValue).map(a=><React.Fragment key={a.id}><tr><td>{a.writtenText}<br/><small>{a.writtenKey}</small></td><td>{a.equipmentDoor||a.equipmentId}{a.equipmentName&&a.equipmentName!==a.equipmentDoor?<><br/><small>{a.equipmentName}</small></>:null}</td><td>{a.equipmentSite||a.site}</td><td title={aliasHover(a)}>{aliasStatusLabel[a.status]||a.status}{a.suspendedReason?<><br/><small>{a.suspendedReason}</small></>:null}</td><td>{aliasRouteLabel(a)}{a.approvedBy?<><br/><small>{a.approvedBy}</small></>:null}</td><td>{a.requestedBy}</td><td>{formatDisplayDateTime(a.approvedAt||a.createdAt)}</td><td><button type="button" aria-expanded={open===a.id} onClick={()=>setOpen(open===a.id?null:a.id)}>{(a.history||[]).length} event(s)</button></td><td>{aliasActions(a)}</td></tr>
    {open===a.id&&<tr className="equipment-alias-history"><td colSpan="9">{historyList(a)}</td></tr>}</React.Fragment>):<tr><td colSpan="9" className="empty-state">No aliases{site||status?' match these filters':' yet'}.</td></tr>}</tbody></table></>}
  {revoke&&<EquipmentAliasRevokeDialog session={session} alias={revoke} otpEnabled={otpEnabled} approver={approver} approverTelegramLinked={approverTelegramLinked} onDone={refresh} onDismiss={()=>setRevoke(null)}/>}
 </section>;
}
