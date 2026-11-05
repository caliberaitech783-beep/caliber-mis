import React from 'react';
import {scanReviewHelp} from './scan-review-layout.mjs';

export default function ScanCorrectionStatus({errors=[],warnings=[],status='',dirty=false,working=''}){
 const required=[...new Set(errors.map(scanReviewHelp))];
 const advisory=[...new Set(warnings.map(scanReviewHelp))].filter(issue=>!required.includes(issue));
 const failed=status.startsWith('Not saved');
 if(working)return <div role="status" className="scan-correction-status scan-review-working">
  <span className="scan-review-spinner" aria-hidden="true"/>
  <div><strong>System is working</strong><div>{working}</div></div>
 </div>;
 if(!status&&!required.length&&!advisory.length)return null;
 const message=status==='All scan corrections saved to MIS.'?'Corrections saved.':status;
 const tone=failed?'scan-error':required.length||dirty?'scan-warning':advisory.length?'scan-review-advisory':'scan-success';
 return <div role="status" className={'scan-correction-status '+tone}>
  {required.length>0&&<div><strong>User input needed</strong> · {required.length} {required.length===1?'item needs':'items need'} checking.</div>}
  {message&&<div>{message}</div>}
  {required.length+advisory.length>0&&<details open={required.length>0||undefined}>
   <summary>{required.length?'View checks':'View notes'}</summary>
   {[...required,...advisory].map(issue=><p key={issue}>{issue}</p>)}
  </details>}
 </div>;
}
