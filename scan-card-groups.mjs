import {manualScanIssues} from './src/scan-manual-fields.mjs';

export const CARD_GROUPS=[
 {id:'orange',label:'All okay',description:'Values complete · saved automatically'},
 {id:'brown',label:'Needs attention',description:'Correct values or fill missing fields'},
 {id:'red',label:'Blank / no data',description:'No usable data, failed or rejected card'}
];
const present=value=>value!==null&&value!==undefined&&String(value).trim()!=='';
export function hasCardData(card){
 const d=card.draft||{},raw=card.raw_fields||{};
 return ['doorText','assetId','employeeId','aFormNo','jobCardNo','openingHmr','closingHmr','openingKmr','closingKmr'].some(k=>present(d[k]))||
  (present(d.bookDate)&&!['system-fallback','scan-unreadable'].includes(d.bookDateSource))||
  ['door','employeeCode','cardNo'].some(k=>present(raw[k]))||
  (d.trips||[]).some(r=>['equipmentName','loadingTime','unloadingTime'].some(k=>present(r[k])));
}
export function cardReviewGroup(card,kind,options=null){
 if(['queued','reading'].includes(card.status))return 'pending';
 if(card.status==='posted')return 'orange';
 if(['error','rejected'].includes(card.status)||!hasCardData(card))return 'red';
 if(Object.keys(manualScanIssues(card.draft,kind,card.raw_fields,options)).length||(card.checks?.errors||[]).length)return 'brown';
 return 'orange';
}
export function reviewGroupSummary(cards,kind,options=null){
 const counts={orange:0,brown:0,red:0,pending:0};
 for(const card of cards)counts[cardReviewGroup(card,kind,options)]++;
 const ready=cards.length>0&&counts.orange===cards.length;
 const approved=ready&&cards.every(c=>c.status==='posted'||(c.status==='approved'&&c.checked_by));
 return {...counts,total:cards.length,ready,canSaveAll:Boolean(approved&&cards.some(c=>c.status!=='posted'))};
}
