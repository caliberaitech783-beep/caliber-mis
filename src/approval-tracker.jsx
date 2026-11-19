import React from 'react';
import './approval-tracker.css';

// Steps in a line: ✓ done, numbered current (purple ring), × rejected, numbered grey pending.
// The line into a step is green when that step is done or current, red when it is rejected.
export function ApprovalTracker({steps=[],label='Approval stage'}){
  return <ol className="apt-steps" aria-label={label}>{steps.map((step,index)=><li key={step.label} className={`apt-step ${step.state}`} aria-current={step.state==='current'?'step':undefined}>
    {index>0&&<span className="apt-line" aria-hidden="true"/>}
    <span className="apt-dot" aria-hidden="true">{step.state==='done'?'✓':step.state==='rejected'?'×':index+1}</span>
    <span className="apt-label">{step.label}<span className="sr-only"> — {step.state}</span></span>
    {step.note&&<small className="apt-note">{step.note}</small>}
  </li>)}</ol>;
}

// One request: title line, status pill and its tracker. The whole card opens the request.
export function ApprovalRequestCard({title,meta,pill,steps,onOpen}){
  const body=<><div className="apt-card-head"><span className="apt-title"><b>{title}</b>{meta&&<span> · {meta}</span>}</span>{pill&&<span className={`apt-pill ${pill.tone}`}>{pill.label}</span>}</div><ApprovalTracker steps={steps}/></>;
  return onOpen?<button type="button" className="apt-card" onClick={onOpen}>{body}</button>:<div className="apt-card">{body}</div>;
}
