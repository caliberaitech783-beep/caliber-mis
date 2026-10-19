import React,{useEffect,useState} from 'react';

export default function PulseMasterSync({session}){
 const [status,setStatus]=useState(null),[error,setError]=useState(''),[working,setWorking]=useState(false),[credentials,setCredentials]=useState({username:'',password:''});
 const [erpStatus,setErpStatus]=useState(null);
 const erpCall=async(sync=false)=>{const response=await fetch('/api/erp-masters/'+(sync?'sync':'status'),{method:sync?'POST':'GET',headers:{Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},...(sync?{body:'{}'}:{})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not load ERP sync.');setErpStatus(data);return data;};
 useEffect(()=>{void erpCall().catch(e=>setError(e.message));const timer=setInterval(()=>void erpCall().catch(()=>{}),15000);return()=>clearInterval(timer)},[session.token]);
 const syncAll=async()=>{setWorking(true);setError('');try{if(status?.connected)setStatus(await call('sync'));if(erpStatus?.configured)await erpCall(true);}catch(e){setError(e.message)}finally{setWorking(false)}};
 const call=async(action='',body)=>{
   const response=await fetch(`/api/pulse-master-sync${action?'/'+action:''}`,{method:action?'POST':'GET',headers:{Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
   const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not load Pulse sync.');return data;
 };
 useEffect(()=>{let live=true;const load=()=>call().then(data=>live&&setStatus(data)).catch(e=>live&&setError(e.message));void load();const timer=setInterval(load,15000);return()=>{live=false;clearInterval(timer)}},[session.token]);
 const act=async(action)=>{setWorking(true);setError('');try{setStatus(await call(action,action==='connect'?credentials:undefined));if(action==='connect')setCredentials({username:'',password:''});}catch(e){setError(e.message)}finally{setWorking(false)}};
 return <section className="panel pulse-sync-page">
   <header><h1>Sync all masters</h1><p>Pulse and ERP masters → Caliber Pulse-II</p><button className="primary" onClick={syncAll} disabled={working||status?.busy||erpStatus?.busy}>{working?'Syncing…':'Sync all masters now'}</button></header><section className="panel" style={{margin:'20px 0'}}><h2>ERP database sync</h2><p>Work Contracts, Financial Years and Companies refresh every 5 minutes. ERP access is read only.</p><p>Last successful sync: {erpStatus?.last_success?new Date(erpStatus.last_success).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'Not synced yet'}</p>{erpStatus?.error&&<p role="alert">{erpStatus.error}</p>}<table style={{width:'100%',textAlign:'left'}}><thead><tr><th>ERP master</th><th>Copied records</th></tr></thead><tbody>{['Work Order master','Financial Year master','Company master'].map(name=><tr key={name}><td>{name}</td><td>{erpStatus?.counts?.[name]??'—'}</td></tr>)}</tbody></table></section>
   <p>Updates are copied from <strong>pulse.cmll.in</strong> every minute while the local ERP backend is running. Nexus never writes changes to Pulse.</p>
   <div className="panel" style={{margin:'20px 0'}}>
     <strong>{status?.connected?'Connected to Pulse':'Pulse connection required'}</strong>
     {status?.username&&<p>Pulse user: {status.username}</p>}
     <p>Last successful sync: {status?.lastSuccess?new Date(status.lastSuccess).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})+' IST':'Not synced yet'}</p>
     {(error||status?.error)&&<p role="alert" style={{color:'#b52a45'}}>{error||status.error}</p>}
     <table style={{width:'100%',textAlign:'left'}}><thead><tr><th>Master</th><th>Copied records</th></tr></thead><tbody>{['Equipment master','Region master','Shift Master','Users & employees'].map(name=><tr key={name}><td style={{padding:'10px 0'}}>{name==='Users & employees'?'Login Details':name}</td><td>{status?.counts?.[name]??'—'}</td></tr>)}</tbody></table>
     {status?.connected&&<div style={{display:'flex',gap:12,marginTop:18}}><button className="primary" disabled={working||status.busy} onClick={()=>act('sync')}>{working||status.busy?'Syncing…':'Sync now'}</button><button disabled={working||status.busy} onClick={()=>act('disconnect')}>Disconnect</button></div>}
   </div>
   <form onSubmit={e=>{e.preventDefault();void act('connect')}} style={{maxWidth:510}}>
     <h2>{status?.connected?'Reconnect Pulse':'Connect Pulse'}</h2>
     <p>Use a Pulse Admin or Super Admin who can read all four masters. Your credentials are sent to pulse.cmll.in for sign-in. Only the resulting session is saved locally; your password is not stored. Reconnect when the Pulse session expires.</p>
     <label style={{display:'block',margin:'14px 0'}}>Pulse user name<input style={{display:'block',width:'100%',marginTop:6}} autoComplete="off" value={credentials.username} onChange={e=>setCredentials({...credentials,username:e.target.value})} required/></label>
     <label style={{display:'block',margin:'14px 0'}}>Pulse password<input type="password" style={{display:'block',width:'100%',marginTop:6}} autoComplete="off" value={credentials.password} onChange={e=>setCredentials({...credentials,password:e.target.value})} required/></label>
     <button className="primary" disabled={working||status?.busy}>{working?'Connecting…':'Connect and copy masters'}</button>
   </form>
   <p style={{marginTop:24}}>Synced masters are read-only in Nexus while connected. Pulse does not expose passwords; existing local passwords are preserved, and newly copied users need a local administrator to set their password. Updates retain local record IDs. Removing a record in Pulse removes its linked local copy at the next sync; unrelated local records are retained. A failed fetch or invalid response leaves the last good local data available.</p>
 </section>;
}
