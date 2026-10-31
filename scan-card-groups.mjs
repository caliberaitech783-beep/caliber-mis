import {machineDiscrepancies} from './trip-card-rules.mjs';
import {scanCardContextIssues} from './scan-batch-context.mjs';
import {manualScanIssues} from './src/scan-manual-fields.mjs';

export const ISSUE_CARD_GROUPS=[
 {id:'wrong-door',label:'Wrong door no.',description:'Missing or invalid door / linked vehicle'},
 {id:'wrong-caliber',label:'Wrong Caliber ID',description:'Missing or unmatched driver / operator'},
 {id:'wrong-hmr',label:'Wrong HMR',description:'Missing, invalid or conflicting hour readings'},
 {id:'wrong-kmr',label:'Wrong KMR',description:'Missing, invalid or conflicting kilometre readings'},
 {id:'mws-ted',label:'MWS / TED mismatch',description:'Machine-wise summary differs from trip entry details'}
];
export const CARD_GROUPS=[
 {id:'orange',label:'All okay',description:'Values complete · saved automatically'},
 {id:'brown',label:'Needs attention',description:'Correct values or fill missing fields'},
 {id:'red',label:'Blank / no data',description:'No usable data or rejected card'},
 {id:'error',label:'Error',description:'Extraction failed or date/site/shift mismatch'},
 ...ISSUE_CARD_GROUPS
];
const present=value=>value!==null&&value!==undefined&&String(value).trim()!=='';
export function hasCardData(card){
 const d=card.draft||{},raw=card.raw_fields||{};
 return ['doorText','assetId','employeeId','aFormNo','jobCardNo','openingHmr','closingHmr','openingKmr','closingKmr'].some(k=>present(d[k]))||
  (present(d.bookDate)&&!['system-fallback','scan-unreadable'].includes(d.bookDateSource))||
  ['door','employeeCode','cardNo'].some(k=>present(raw[k]))||
  (d.trips||[]).some(r=>['equipmentName','loadingTime','unloadingTime'].some(k=>present(r[k])));
}
export function cardReviewGroup(card,kind,options=null,context=null){
 if(['queued','reading'].includes(card.status))return 'pending';
 if(card.status==='posted')return 'orange';
 if(card.status!=='rejected'&&(card.context_mismatch?.length||(context&&scanCardContextIssues(context,card).length)))return 'error';
 if(card.status==='error')return 'error';
 if(card.status==='rejected'||!hasCardData(card))return 'red';
 if(Object.keys(manualScanIssues(card.draft,kind,card.raw_fields,options)).length||(card.checks?.errors||[]).length)return 'brown';
 return 'orange';
}
export function reviewGroupSummary(cards,kind,options=null,context=null){
 const counts={orange:0,brown:0,red:0,error:0,pending:0,...Object.fromEntries(ISSUE_CARD_GROUPS.map(group=>[group.id,0]))};
 for(const card of cards){
  const primary=cardReviewGroup(card,kind,options,context),issueGroups=cardIssueGroups(card,kind,options);
  if(primary!=='brown'||issueGroups.length===0)counts[primary]++;
  for(const group of issueGroups)counts[group]++;
 }
 const ready=cards.length>0&&counts.orange===cards.length;
 const approved=ready&&cards.every(c=>c.status==='posted'||(c.status==='approved'&&c.checked_by));
 return {...counts,total:cards.length,ready,canSaveAll:Boolean(approved&&cards.some(c=>c.status!=='posted'))};
}

export function cardIssueGroups(card,kind,options=null){
 if(['queued','reading','posted','rejected'].includes(card.status)||!hasCardData(card))return [];
 const draft=card.draft||{},issues=manualScanIssues(draft,kind,card.raw_fields,options),errors=(card.checks?.errors||[]).join(' '),groups=[];
 if(issues.doorText||issues.assetId||/door number|linked equipment|vehicle.*not.*found/i.test(errors)||(card.raw_fields?.fleetReview?.issues||[]).some(issue=>issue.fields?.includes('doorText')))groups.push('wrong-door');
 if(issues.employeeId||/caliber|employee|driver|operator/i.test(errors))groups.push('wrong-caliber');
 if(issues.openingHmr||issues.closingHmr||/\bHMR\b/i.test(errors))groups.push('wrong-hmr');
 if(kind==='vehicle'&&(issues.openingKmr||issues.closingKmr||/\bKMR\b/i.test(errors)))groups.push('wrong-kmr');
 if(kind==='vehicle'&&machineDiscrepancies(draft.trips||[],draft.scanMachineSummary||[]).length)groups.push('mws-ted');
 return groups;
}
export function matchesCardGroup(card,group,kind,options=null,context=null){
 if(group==='all')return true;
 const issueGroups=cardIssueGroups(card,kind,options);
 if(ISSUE_CARD_GROUPS.some(item=>item.id===group))return issueGroups.includes(group);
 return cardReviewGroup(card,kind,options,context)===group&&(group!=='brown'||issueGroups.length===0);
}
