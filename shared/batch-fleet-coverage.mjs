// Every machine of a batch's site needs an answer for the shift (owner, 25 Nov 2026): if a site has
// 100 VLB, 23 ELB and 15 LMV machines, each one is either on a saved card of the batch or has a
// status: breakdown / maintenance from Pulse-1, or an idle reason. The batch page counts and lists
// the machines with no answer yet, book by book. It warns and never stops a lock or a close.
import {canonicalSiteName,equipmentSiteName} from './site-location.mjs';
import {masterCategory,assetBookKind} from './equipment-kind.mjs';
import {equipmentDoorNumber} from './equipment-door.mjs';
import {sitePulseRequests,pulseShiftStatus} from './pulse-shift-status.mjs';

export const COVERAGE_BOOKS=Object.freeze([
 {key:'vlb',kind:'vehicle',label:'VLB'},
 {key:'elb',kind:'equipment',label:'ELB'},
 {key:'lmv',kind:'lmv',label:'LMV'},
]);

const text=value=>String(value??'').trim();

// What a VLB or LMV machine with no card can be answered with (owner, 25 Nov 2026, part 2). Pulse is read from
// Pulse-1; an idle reason is chosen by the MIS user, with a written reason. An ELB machine is answered on the ELB
// fleet list, as before.
export const IDLE_REASONS=Object.freeze({
 no_operator:'No operator',
 not_in_use:'Not in use',
 no_work:'No work',
 standby:'Standby',
 transferred_out:'Transferred out / at another site',
});
export const ANSWER_LABELS=Object.freeze({card:'Card saved',pulse:'Breakdown / maintenance (Pulse-1)',pulse_idle:'Idle in Pulse-1',pulse_partial:'Part-shift breakdown in Pulse-1: card needed',...IDLE_REASONS});
export const ANSWER_BOOKS=Object.freeze(['vlb','lmv']);
export const MIN_REASON_LENGTH=3;
const ANSWERED=new Set(['card','pulse','pulse_idle',...Object.keys(IDLE_REASONS)]);

// The error for an idle answer, '' when it can be saved.
export function idleAnswerIssue({book,status,reason}={}){
 if(!ANSWER_BOOKS.includes(book))return 'Only a VLB or LMV machine takes an idle reason here; an ELB machine is entered on the ELB fleet list.';
 if(!IDLE_REASONS[status])return 'Choose why the machine has no card: '+Object.values(IDLE_REASONS).join(', ')+'.';
 const written=text(reason);
 if(written.length<MIN_REASON_LENGTH)return 'Write the reason (at least '+MIN_REASON_LENGTH+' letters).';
 if(written.length>500)return 'Keep the reason under 500 letters.';
 return '';
}
const RETIRED=/inactive|scrap|sold|dispos|written.?off|retired/i;
export const assetSite=asset=>text(equipmentSiteName(asset)||asset?.currentLocation||asset?.site||asset?.location);
export const assetDoor=asset=>text(asset?.door||asset?.doorNo||asset?.lmvDoor||equipmentDoorNumber(asset||{}))||text(asset?.registration||asset?.equipmentName||asset?.equipment||asset?.name);
export const assetName=asset=>text(asset?.equipmentName||asset?.equipment||asset?.name||asset?.group||asset?.equipmentGroup);
const byDoor=(a,b)=>String(a.door).localeCompare(String(b.door),undefined,{numeric:true});

// The book a machine belongs to: its Equipment category in the master, else its group (as the save does).
export function assetCoverageKind(asset={}){
 if(asset?.lmv===true)return 'lmv';
 return masterCategory(asset)||assetBookKind(asset);
}
export const activeAsset=asset=>Boolean(asset)&&!asset.sourceMissing&&!RETIRED.test(text(asset.status||asset.equipmentStatus));
const BOOK_OF_KIND={vehicle:'vlb',equipment:'elb',lmv:'lmv'};
// The machine of the site that this book's answer may be saved for, or the reason it may not.
export function answerMachineIssue(asset,{site,book}={}){
 if(!asset)return 'This machine is not in the Equipment Master.';
 if(!activeAsset(asset))return 'This machine is not active in the Equipment Master.';
 if(canonicalSiteName(assetSite(asset))!==canonicalSiteName(site))return 'The Equipment Master does not put this machine at this site.';
 if(BOOK_OF_KIND[assetCoverageKind(asset)]!==book)return 'This machine does not belong to the '+String(book).toUpperCase()+' book in the Equipment Master.';
 return '';
}

// The machines the Equipment Master puts at the site, per book.
export function siteRoster(assets=[],site){
 const canonical=canonicalSiteName(site),roster={vehicle:[],equipment:[],lmv:[]};
 for(const asset of assets){
  if(!activeAsset(asset)||canonicalSiteName(assetSite(asset))!==canonical)continue;
  const kind=assetCoverageKind(asset);
  roster[kind]?.push({assetId:String(asset.id),door:assetDoor(asset),name:assetName(asset)});
 }
 return roster;
}

const recordAsset=record=>text(record?.asset_id??record?.assetId??record?.data?.assetId);
const recordBook=record=>text(record?.book_no||record?.bookNo||record?.data?.bookNo);

function bookCoverage(book,roster,answers,assets,saved=new Map(),pulse=null){
 const rows=new Map(roster.map(machine=>[machine.assetId,{...machine,atSite:true,answer:'',cards:[]}]));
 for(const [assetId,answer] of answers){
  if(!assetId)continue;
  let row=rows.get(assetId);
  if(!row){
   // A card of this batch for a machine the master lists at another site still counts, and is shown apart.
   const asset=assets.get(assetId);
   row={assetId,door:asset?assetDoor(asset):assetId,name:asset?assetName(asset):'',atSite:false,answer:'',cards:[]};
   rows.set(assetId,row);
  }
  row.answer=row.answer||answer.answer;
  row.cards.push(...answer.cards);
 }
 // A saved Pulse-1 or idle answer of a machine at the site. A card always wins over it.
 for(const [assetId,entry] of saved){
  const row=rows.get(String(assetId));if(!row)continue;
  row.saved=entry;
  if(!row.answer&&ANSWERED.has(entry.status))row.answer=entry.status;
  if(!row.answer&&entry.status==='pulse_partial')row.note=ANSWER_LABELS.pulse_partial;
 }
 // What Pulse-1 holds for the shift answers a machine nobody answered by hand (owner, 25 Nov 2026): a whole-shift
 // breakdown / maintenance, or an idle request. A part-shift breakdown means the machine also worked, so a card is needed.
 if(pulse)for(const row of rows.values()){
  const status=pulse.get(row.assetId);if(!status)continue;
  row.pulse=status;
  if(row.answer)continue;
  if(status.wholeShift)row.answer='pulse';
  else if(status.idle)row.answer='pulse_idle';
  else if(status.breakdownHours>0)row.note=ANSWER_LABELS.pulse_partial;
 }
 const all=[...rows.values()].sort(byDoor);
 const missing=all.filter(row=>!row.answer);
 const atSite=all.filter(row=>row.atSite);
 const count=test=>atSite.filter(row=>test(row.answer)).length;
 return {book:book.key,label:book.label,total:atSite.length,answered:count(answer=>Boolean(answer)),
  cards:count(answer=>answer==='card'),pulse:count(answer=>answer==='pulse'),idle:count(answer=>answer==='pulse_idle'||Boolean(IDLE_REASONS[answer])),
  otherSite:all.filter(row=>!row.atSite).length,remaining:missing.length,missing,complete:missing.length===0,rows:all,takesAnswers:ANSWER_BOOKS.includes(book.key)};
}

function cardAnswers(records){
 const answers=new Map();
 for(const record of records){
  const id=recordAsset(record);if(!id)continue;
  const entry=answers.get(id)||{answer:'card',cards:[]};
  const book=recordBook(record);if(book&&!entry.cards.includes(book))entry.cards.push(book);
  answers.set(id,entry);
 }
 return answers;
}

// vlbRecords and lmvRecords: the batch's saved cards. elbFleet: the batch's ELB fleet list (a line counts once its
// ELB is saved with a shift status, as Close batch reads it). answers: the batch's saved Pulse-1 / idle answers of
// VLB and LMV machines, [{book,assetId,status,reason,breakdownHours,...}].
// pulse: Pulse-II's copy of Pulse's breakdown list and the batch's shift, {rows,window,now,readAt,error}; without it the
// page says Pulse-1 could not be read and VLB / LMV machines are answered by card or by hand only.
export function batchFleetCoverage({assets=[],site,vlbRecords=[],lmvRecords=[],elbFleet=[],elbRecords=[],answers=[],pulse=null}={}){
 const index=new Map(assets.map(asset=>[String(asset.id),asset]));
 const roster=siteRoster(assets,site);
 const savedFor=book=>new Map(answers.filter(one=>one.book===book).map(one=>[String(one.assetId),one]));
 const pulseRead=pulse?.rows&&pulse?.window?{ok:true,readAt:pulse.readAt||null}:{ok:false,error:pulse?.error||(pulse?.window===null?'The batch shift has no Shift Master start time.':'Pulse-1 could not be read.')};
 const pulseFor=list=>{
  if(!pulseRead.ok)return null;
  const requests=sitePulseRequests(pulse.rows,site),out=new Map();
  for(const machine of list){const asset=index.get(machine.assetId);const status=pulseShiftStatus(asset,requests,pulse.window,pulse.now??Date.now());if(status&&(status.breakdownHours>0||status.idle))out.set(machine.assetId,status);}
  return out;
 };
 // The ELB fleet list already holds the site's Equipment and the machines the VLB cards loaded.
 const elbRoster=elbFleet.length?elbFleet.filter(row=>row.atSite!==false).map(row=>({assetId:String(row.assetId??row.asset_id),door:text(row.door),name:text(row.equipmentName||row.equipment_name)})):roster.equipment;
 const elbAnswers=cardAnswers(elbRecords.filter(record=>!record.deleted_at));
 for(const row of elbFleet){
  if(!(row.saved_at&&(row.shift_status||row.shiftStatus)))continue;
  const id=String(row.assetId??row.asset_id),entry=elbAnswers.get(id)||{answer:'card',cards:[]};
  if(row.book_no&&!entry.cards.includes(row.book_no))entry.cards.push(row.book_no);
  elbAnswers.set(id,entry);
 }
 const books={
  vlb:bookCoverage(COVERAGE_BOOKS[0],roster.vehicle,cardAnswers(vlbRecords),index,savedFor('vlb'),pulseFor(roster.vehicle)),
  elb:bookCoverage(COVERAGE_BOOKS[1],elbRoster,elbAnswers,index),
  lmv:bookCoverage(COVERAGE_BOOKS[2],roster.lmv,cardAnswers(lmvRecords),index,savedFor('lmv'),pulseFor(roster.lmv)),
 };
 const warnings=Object.values(books).filter(book=>!book.complete).map(coverageWarning);
 return {mode:'warning',books,complete:!warnings.length,warnings,idleReasons:IDLE_REASONS,answerLabels:ANSWER_LABELS,pulseRead};
}

export function coverageWarning(book){
 const shown=book.missing.slice(0,25).map(row=>row.door||row.assetId);
 const more=book.missing.length-shown.length;
 return `${book.label} ${book.answered}/${book.total} machines answered; no answer yet: ${shown.join(', ')}${more>0?` and ${more} more`:''}.`;
}
