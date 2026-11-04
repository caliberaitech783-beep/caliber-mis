import React from 'react';
import {scanReviewHelp} from './scan-review-layout.mjs';
export default function ScanCorrectionStatus({errors=[],warnings=[],status='',dirty=false}){
 const issues=[...errors,...warnings].map(scanReviewHelp);
 if(!status&&!issues.length)return null;
 const failed=status.startsWith('Not saved'),saved=status==='All scan corrections saved to MIS.';
 const message=saved?'Corrections saved.':status;
 const pending=issues.length?issues.length+' '+(issues.length===1?'item needs':'items need')+' checking.':'';
 return <div role="status" className={'scan-correction-status '+(failed?'scan-error':dirty||issues.length?'scan-warning':'scan-success')}>{[message,pending].filter(Boolean).join(' ')}{issues.length>0&&<details><summary>View checks</summary>{issues.map((issue,index)=><p key={index}>{issue}</p>)}</details>}</div>;
}
