import {CARD_GROUPS,cardIssueGroups,cardReviewGroup} from '../scan-card-groups.mjs';
import {manualScanIssues} from './scan-manual-fields.mjs';
const fields={bookDate:['bookDate'],location:['location'],door:['doorText','assetId'],employeeCode:['employeeId'],employeeName:['employeeId'],shift:['shiftId','cardShift'],shiftHours:['shiftHours'],workOrder:['workOrderId'],cardNo:['aFormNo','jobCardNo'],openingHmr:['openingHmr'],closingHmr:['closingHmr'],hours:['openingHmr','closingHmr'],openingKmr:['openingKmr'],closingKmr:['closingKmr'],kilometres:['openingKmr','closingKmr'],trips:['trips','scanMachineSummary']};
export const CARD_STATUS_LEGEND=[['error','Error / mismatch'],['red','Blank / rejected'],['brown','Needs correction'],['pending','Processing'],['orange','Complete / saved']];
export function scanReportCardStatus(card,kind,options,context,row){
 let tone=cardReviewGroup(card,kind,options,context);
 if(row?.deleted||row?.contextIssues?.length||(card.status==='posted'&&!row?.saved))tone='error';
 const processing=['queued','reading'].includes(card.status),saved=row?.saved;
 const fieldIssues=processing||saved||card.status==='rejected'?{}:manualScanIssues(card.draft||{},kind,card.raw_fields||{},options);
 const groups=cardIssueGroups(card,kind,options);
 const badges=groups.map(id=>({id,label:CARD_GROUPS.find(group=>group.id===id).label}));
 const messages=processing||saved?[]:[...new Set([...(row?.contextIssues||[]),...(card.checks?.errors||[]),...Object.values(fieldIssues),...(card.error?[card.error]:[])])];
 const cells={};
 for(const [column,keys] of Object.entries(fields)){
  const reasons=Object.entries(fieldIssues).filter(([key])=>keys.some(field=>key===field||key.startsWith(field+'.'))).map(([,reason])=>reason);
  const group={door:'wrong-door',employeeCode:'wrong-caliber',employeeName:'wrong-caliber',openingHmr:'wrong-hmr',closingHmr:'wrong-hmr',hours:'wrong-hmr',openingKmr:'wrong-kmr',closingKmr:'wrong-kmr',kilometres:'wrong-kmr',trips:'mws-ted'}[column];
  if(group&&groups.includes(group)&&!reasons.length)reasons.push(CARD_GROUPS.find(g=>g.id===group).description);
  if(['bookDate','location','shift'].includes(column)&&row?.contextIssues?.length)reasons.push(...row.contextIssues.filter(issue=>new RegExp(column==='bookDate'?'date':column==='location'?'site':'shift','i').test(issue)));
  if(reasons.length)cells[column]={tone:row?.[column]===null||row?.[column]===undefined||row?.[column]===''?'red':'brown',message:[...new Set(reasons)].join(' · ')};
 }
 if(tone==='orange'&&!saved&&messages.length)tone='brown';
 const label=processing?'Processing':saved?'Saved':card.status==='rejected'?'Rejected':row?.deleted?'Deleted log book':tone==='orange'?'Ready to save':CARD_STATUS_LEGEND.find(([id])=>id===tone)?.[1]||'Needs correction';
 return {tone,label,badges,messages,cells};
}
