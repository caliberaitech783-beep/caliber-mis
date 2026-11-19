// Approval tracker for an employee transfer (owner, 20 Nov 2026): Submitted → Source approval →
// Destination acceptance → Completed, drawn like the leave / OD request trackers.
const STEP_LABELS=['Submitted','Source approval','Destination acceptance','Completed'];

export function transferTrackerSteps(record={}){
  const status=String(record.status||'');
  const rejectedAt=status==='Rejected'?(record.approvedAt||record.approvedBy?2:1):-1;
  const current=status==='Completed'?4:status==='Awaiting destination acceptance'?2:status==='Awaiting source approval'?1:rejectedAt;
  const notes=[record.submittedBy||'',
    rejectedAt===1?record.rejectedBy||'':record.approvedBy||record.sourceApproverRole||'',
    rejectedAt===2?record.rejectedBy||'':record.acceptedBy||record.destinationApproverRole||'',
    status==='Completed'?'Location updated':''];
  return STEP_LABELS.map((label,index)=>({label,note:notes[index],state:index===rejectedAt?'rejected':rejectedAt>=0?(index<rejectedAt?'done':'pending'):index<current||status==='Completed'?'done':index===current?'current':'pending'}));
}

// Steps for a request that is still being filled in.
export const draftTrackerSteps=()=>[{label:'Draft',note:'Being filled',state:'current'},...STEP_LABELS.slice(1).map(label=>({label,note:'',state:'pending'}))];

export function transferTrackerPill(record={}){
  const status=String(record.status||'');
  if(status==='Completed')return {label:'Completed',tone:'done'};
  if(status==='Rejected')return {label:record.approvedAt||record.approvedBy?'Rejected at destination':'Rejected at source',tone:'rejected'};
  if(status==='Awaiting destination acceptance')return {label:'Pending · step 3 of 4',tone:'pending'};
  if(status==='Awaiting source approval')return {label:'Pending · step 2 of 4',tone:'pending'};
  return {label:status||'Draft',tone:'pending'};
}
