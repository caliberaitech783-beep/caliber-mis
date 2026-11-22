import React from 'react';

// What a Sync of Employee Master or Employee Transfer from HR would change (server/services/hr-employee-sync.mjs).
// Nothing is written until Apply.
const n=value=>Number(value||0).toLocaleString('en-IN');
const EMPLOYEE_LISTS=[['added','New in HR',row=>`${row.site||''}${row.designation?' · '+row.designation:''}`],['siteChanged','Site changed',row=>`${row.site} → ${row.to}`],
 ['nameChanged','Name changed',row=>`${row.name} → ${row.to}`],['left','HR marks LEFT',row=>row.site],['workingAgain','Working again in HR',row=>row.site],
 ['notListed','Not on HR\'s list',row=>row.site],['siteKept','Site kept in Pulse-II',row=>`HR: ${row.hrSite} · ${row.reason}`]];

function EmployeeChanges({data}){
 const s=data.summary,lines=EMPLOYEE_LISTS.flatMap(([key,label,detail])=>(data.lists?.[key]||[]).map(row=>({key:key+row.employeeId+(row.id||''),label,row,detail:detail(row)})));
 return <>
  <div className="hr-sync-metrics">{[['HR lines',s.lines],['New in HR',s.added],['Details updated',s.updated],['Site changed',s.siteChanged],['HR marks LEFT',s.left],['Not on HR\'s list',s.notListed],['No change',s.unchanged]].map(([label,value])=><div key={label}><span>{label}</span><b>{n(value)}</b></div>)}</div>
  {data.leftOut?.lines>0&&<p className="master-sync-note"><strong>{n(data.leftOut.lines)} HR line(s) cannot be placed and are left out;</strong> those people stay as they are in Pulse-II. {data.leftOut.problems.slice(0,5).map(p=>`${p.employeeId} ${p.name}: ${p.problem}`).join(' · ')}</p>}
  {s.sitesNotInFile?.length>0&&<p className="master-sync-note">Not covered by HR, left as they are: {s.sitesNotInFile.map(row=>`${row.site} (${n(row.people)})`).join(', ')}.</p>}
  <div className="master-sync-table"><table><thead><tr><th>Employee ID</th><th>Name</th><th>Change</th><th>Detail</th></tr></thead><tbody>
   {lines.length?lines.map(line=><tr key={line.key}><td>{line.row.employeeId}</td><td>{line.row.name}</td><td>{line.label}</td><td>{line.detail}</td></tr>):<tr><td colSpan={4}>Pulse-II already matches HR.</td></tr>}
  </tbody></table></div>
 </>;
}

function TransferChanges({data}){
 const s=data.summary;
 return <>
  <div className="hr-sync-metrics">{[['Approved in HR',s.transfers],['Will move',s.move],['Already at that site',s.atSite],['Waiting',s.waiting],['Already in Pulse-II',s.done]].map(([label,value])=><div key={label}><span>{label}</span><b>{n(value)}</b></div>)}</div>
  <div className="master-sync-table"><table><thead><tr><th>HR transfer</th><th>Employee</th><th>From → To</th><th>Transfer date</th><th>In Pulse-II</th></tr></thead><tbody>
   {data.items.length?data.items.map(item=><tr key={item.id}><td>{item.code||item.id}</td><td>{item.employeeId} {item.name}</td><td>{item.from||item.fromSite} → {item.to||item.toSite}</td><td>{item.transferDate?new Date(item.transferDate+'T00:00:00').toLocaleDateString('en-IN'):''}</td><td>{item.outcome}</td></tr>):<tr><td colSpan={5}>Every approved HR transfer is already in Pulse-II.</td></tr>}
  </tbody></table></div>
 </>;
}

export default function HrSyncPreview({preview,label,working,onApply,onClose}){
 const employees=preview.master==='Employee master';
 return <section className="hr-sync-preview" aria-label={`Preview of ${label} from HR`}>
  <header><h2>Preview · {label} from HR</h2><span>Nothing changed yet</span></header>
  {preview.stop&&<p className="master-sync-error" role="alert">{preview.stop.replace('Nothing was changed. Open Preview, check and apply.','The hourly sync waits for this preview to be applied.')}</p>}
  {employees?<EmployeeChanges data={preview}/>:<TransferChanges data={preview}/>}
  <footer><button type="button" onClick={onClose} disabled={working}>Close</button><button type="button" className="primary" onClick={onApply} disabled={working}>{working?'Applying…':'Apply these changes'}</button></footer>
 </section>;
}
