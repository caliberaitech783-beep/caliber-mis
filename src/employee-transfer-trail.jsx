import React,{useEffect,useState} from 'react';
import {ApprovalRequestCard} from './approval-tracker.jsx';
import {transferTrackerSteps,transferTrackerPill} from '../shared/employee-transfer-tracker.mjs';
import {formatDisplayDate} from '../shared/date-time-format.mjs';

// Transfer requests of one employee, shown in their C-Directory profile. Hidden for users
// without Employee Transfer access and for employees with no transfer.
export default function EmployeeTransferTrail({token,empId}){
  const [state,setState]=useState({key:'',records:[]});const key=`${token}|${empId}`;
  useEffect(()=>{
    if(!token||!empId)return undefined;let alive=true;
    fetch(`/api/cdir/employee-transfers/employee/${encodeURIComponent(empId)}`,{cache:'no-store',headers:{Authorization:`Bearer ${token}`}})
      .then(response=>response.ok?response.json():{records:[]}).then(body=>{if(alive)setState({key,records:Array.isArray(body.records)?body.records:[]});})
      .catch(()=>{if(alive)setState({key,records:[]});});
    return()=>{alive=false;};
  },[key]);
  const records=state.key===key?state.records:[];
  if(!records.length)return null;
  return <section className="cdir-transfer-trail" aria-label="Transfer requests"><h3>Transfer requests</h3>{records.map(record=><ApprovalRequestCard key={record.id} title={`${record.transferNo} · ${record.source} → ${record.destination}`} meta={[record.transferType,record.effectiveDate&&`Joining ${formatDisplayDate(record.effectiveDate)}`].filter(Boolean).join(' · ')} pill={transferTrackerPill(record)} steps={transferTrackerSteps(record)}/>)}{records.some(record=>record.rejectionReason)&&<p className="cdir-transfer-note">Rejection reason: {records.find(record=>record.rejectionReason).rejectionReason}</p>}</section>;
}
