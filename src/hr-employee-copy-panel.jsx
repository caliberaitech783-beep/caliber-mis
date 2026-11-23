// Employee Master copied from HR Pulse every minute (owner, 23 Nov 2026; server/services/hr-employee-minute-copy.mjs).
// Under the masters table on Sync all masters: whether the copy runs, why it stopped, and the changes it holds
// for a person to look at. A changed name can be accepted here; everything else is corrected in HR Pulse.
import React from 'react';

const when=value=>value?new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}):'';
const ACCEPTABLE=new Set(['other-name','old-person']);
const n=value=>Number(value||0).toLocaleString('en-IN');

// The site moves made in Pulse-II with an OTP on a card, on their way to HR Pulse (server/services/hr-site-move-outbox.mjs).
function SiteMovesToHr({moves}){
 if(!moves||(!moves.waiting&&!(moves.held||[]).length))return null;
 const lines=[...(moves.notSent||[]),...(moves.held||[])];
 return <>
  <p className="master-sync-note"><strong>Site moves made here with an OTP:</strong> {n(moves.waiting)} waiting to reach HR Pulse{moves.waitingSince?` (since ${when(moves.waitingSince)})`:''}, {n((moves.held||[]).length)} held by HR Pulse. A waiting move is sent again every minute. A held one changed nothing in HR Pulse: HR corrects its line there.</p>
  <div className="master-sync-table"><table><thead><tr><th>Employee ID</th><th>Name</th><th>From → To</th><th>From date</th><th>In HR Pulse</th></tr></thead><tbody>
   {lines.map(line=><tr key={line.moveId}><td>{line.employeeId}</td><td>{line.name}</td><td>{line.from} → {line.to}</td><td>{line.fromDate?new Date(line.fromDate+'T00:00:00').toLocaleDateString('en-IN'):''}</td>
    <td>{line.sentAt?`Held: ${line.detail}`:`Not sent yet (${n(line.tries)} tr${line.tries===1?'y':'ies'})${line.detail?': '+line.detail:''}`}</td></tr>)}
  </tbody></table></div>
 </>;
}

// The nightly match of both whole lists, and a button to match them now.
function NightlyMatch({copy,working,onMatch}){
 if(!copy.started)return null;
 const last=copy.lastMatch,s=last?.summary;
 return <p className="master-sync-note"><strong>Match of both whole lists (every night from {String(copy.matchHour??2).padStart(2,'0')}:00):</strong>{' '}
  {!last?'not done yet.'
   :last.stopped?`stopped on ${when(last.at)}.`
   :last.same?`the same on ${when(last.at)}: nothing to correct (${n(last.hrPeople)} people in HR Pulse)${last.held?`, ${n(last.held)} held`:''}.`
   :`not the same on ${when(last.at)}; corrected in Pulse-II: ${n(s.added)} added, ${n(s.updated)} updated, ${n(s.removed)} removed, ${n(s.left)} marked LEFT, ${n(s.moved)} moved${last.held?`; ${n(last.held)} held`:''}.`}
  {' '}<button type="button" disabled={Boolean(working)||Boolean(copy.stopped)} onClick={onMatch}>{working==='match'?'Matching…':'Match both lists now'}</button></p>;
}

export default function HrEmployeeCopyPanel({copy,moves,working,onAccept,onMatch}){
 if(!copy)return null;
 const held=copy.held||[],last=copy.lastSummary;
 return <section className="hr-copy-panel" aria-label="Employee Master copy from HR Pulse">
  <h2>Employee Master from HR Pulse</h2>
  {!copy.connected?<p className="master-sync-note">HR Pulse is not connected on this server (HR_SYNC_KEY).</p>
   :!copy.started?<p className="master-sync-note"><strong>Not started.</strong> Press Preview on the Employee Master line, look at the changes and apply them once. After that every change made in HR Pulse is copied here within a minute.</p>
   :copy.stopped?null
   :<p className="master-sync-note"><strong>Copied every minute.</strong> Last look at HR Pulse: {when(copy.lastRunAt)||'not yet'}.{copy.lastChangeAt?` Last change copied: ${when(copy.lastChangeAt)}`+(last?` (${n(last.added)} added, ${n(last.updated)} updated, ${n(last.removed)} removed, ${n(last.left)} marked LEFT, ${n(last.moved)} moved).`:'.'):' No change copied yet.'}</p>}
  <NightlyMatch copy={copy} working={working} onMatch={onMatch}/>
  {copy.stopped&&<p className="master-sync-error" role="alert"><strong>Stopped at {when(copy.stopped.at)}.</strong> {copy.stopped.reason}</p>}
  {!copy.stopped&&copy.error&&<p className="master-sync-error" role="alert">{copy.error}</p>}
  {held.length>0&&<>
   <p className="master-sync-note"><strong>{n(held.length)} change{held.length===1?' is':'s are'} held.</strong> Nothing was changed for these people. Correct the line in HR Pulse; a changed name that is right can be accepted here.</p>
   <div className="master-sync-table"><table><thead><tr><th>Employee ID</th><th>Name in HR Pulse</th><th>Why it is held</th><th>Held since</th><th>Action</th></tr></thead><tbody>
    {held.map(item=><tr key={item.number+item.reason}><td>{item.employeeId}</td><td>{item.name}</td><td>{item.detail}</td><td>{when(item.since)}</td>
     <td>{ACCEPTABLE.has(item.reason)?<button type="button" disabled={Boolean(working)} onClick={()=>onAccept(item)}>{working==='accept:'+item.number?'Accepting…':'Accept this name'}</button>:'Correct in HR Pulse'}</td></tr>)}
   </tbody></table></div>
  </>}
  <SiteMovesToHr moves={moves}/>
 </section>;
}
