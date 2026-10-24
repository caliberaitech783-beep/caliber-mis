import {manualScanIssues} from './scan-manual-fields.mjs';
const completed=new Set(['review','approved','posted','error']);
export function scanBatchMetrics(cards,kind,options=null){
 const assessed=cards.filter(card=>completed.has(card.status));
 const failures=assessed.filter(card=>card.status==='error').length;
 const errors=assessed.filter(card=>card.status==='error'||Object.keys(manualScanIssues(card.draft,kind,card.raw_fields,options)).length>0||(card.checks?.errors||[]).some(message=>!/^Confirm or correct the highlighted meter readings/i.test(message))).length;
 return {assessed:assessed.length,errors,failures,errorPercent:assessed.length?100*errors/assessed.length:null,failurePercent:assessed.length?100*failures/assessed.length:null};
}
