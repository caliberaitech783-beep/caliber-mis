// Local-only fixture: actual production components, in-memory sample API, no database connection.
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import VlbReopenDialog from '../../src/vlb-reopen-dialog.jsx';
import VlbBatchApprovals from '../../src/vlb-batch-approvals.jsx';
import '../../src/vlb-create-batch.css';
const batch={id:'00000000-0000-4000-8000-000000000001',name:'CMLL/SASTI OC/30TH -OCT-26/S1/B01',site:'Sasti OC',report_date:'2026-10-30',shift:'S1',closed_at:'2026-10-30T12:45:00Z',closure_revision:1,canRequestReopen:true,canReopen:false,requests:[]};
window.fetch=async(url,options={})=>{
 if(!String(url).startsWith('/api/vlb-batches'))throw Error('Fixture API only');
 const body=options.body?JSON.parse(options.body):{};
 if(String(url).endsWith('/reopen-request'))batch.requests.unshift({id:crypto.randomUUID(),batch_id:batch.id,name:batch.name,site:batch.site,report_date:batch.report_date,shift:batch.shift,closed_at:batch.closed_at,current_revision:batch.closure_revision,closure_revision:batch.closure_revision,requested_by:'sample-mis-user',requested_at:new Date().toISOString(),reason:body.reason,status:'pending',canDecide:true});
 if(String(url).endsWith('/reopen-decision')){const request=batch.requests.find(r=>r.id===body.requestId);Object.assign(request,{status:body.decision==='approve'?'approved':'rejected',canDecide:false,decision_note:body.note,decided_by:'sample-site-pm'});batch.canReopen=body.decision==='approve';}
 if(String(url).endsWith('/reopen')){batch.closed_at=null;batch.amendment_by='sample-mis-user';batch.requests[0].status='used';}
 return {ok:true,json:async()=>structuredClone(String(url).endsWith('/approvals')?{requests:batch.requests}:String(url).endsWith('/reopen-request')?batch.requests[0]:batch)};
};
function Fixture(){const [mode,setMode]=useState('user'),[open,setOpen]=useState(false),[refresh,setRefresh]=useState(0);return <main style={{maxWidth:1000,margin:'24px auto',padding:16,fontFamily:'Segoe UI,sans-serif'}}><p>LOCAL UI TEST · SAMPLE DATA · NO DATABASE</p><div style={{display:'flex',gap:12,flexWrap:'wrap'}}><button type="button" onClick={()=>{setMode('user');setOpen(true)}}>Show user approval popup</button><button type="button" onClick={()=>setMode('pm')}>Show PM approval screen</button></div>{mode==='pm'?<VlbBatchApprovals session={{token:'sample-pm'}} refresh={refresh} onChanged={()=>setRefresh(n=>n+1)}/>:<><p>Saved batch: {batch.name}</p><p>{batch.closed_at?'Saved · Locked':'Reopened for sample-mis-user'}</p>{open&&<VlbReopenDialog session={{token:'sample-user'}} batch={batch} actor={{login:'sample-mis-user',mis:true}} onChanged={()=>setRefresh(n=>n+1)} onDismiss={()=>setOpen(false)}/>}</>}</main>}
createRoot(document.getElementById('root')).render(<Fixture/>);
