// Every machine of a batch's site needs an answer for the shift (owner, 25 Nov 2026): if a site has
// 100 VLB, 23 ELB and 15 LMV machines, each one is either on a saved card of the batch or has a
// status (breakdown / maintenance / idle, coming next). This first part only counts and lists the
// machines with no answer yet, book by book. It warns and never stops a lock or a close.
import {canonicalSiteName,equipmentSiteName} from './site-location.mjs';
import {masterCategory,assetBookKind} from './equipment-kind.mjs';
import {equipmentDoorNumber} from './equipment-door.mjs';

export const COVERAGE_BOOKS=Object.freeze([
 {key:'vlb',kind:'vehicle',label:'VLB'},
 {key:'elb',kind:'equipment',label:'ELB'},
 {key:'lmv',kind:'lmv',label:'LMV'},
]);

const text=value=>String(value??'').trim();
const RETIRED=/inactive|scrap|sold|dispos|written.?off|retired/i;
const assetSite=asset=>text(equipmentSiteName(asset)||asset?.currentLocation||asset?.site||asset?.location);
const assetDoor=asset=>text(asset?.door||asset?.doorNo||asset?.lmvDoor||equipmentDoorNumber(asset||{}))||text(asset?.registration||asset?.equipmentName||asset?.equipment||asset?.name);
const assetName=asset=>text(asset?.equipmentName||asset?.equipment||asset?.name||asset?.group||asset?.equipmentGroup);
const byDoor=(a,b)=>String(a.door).localeCompare(String(b.door),undefined,{numeric:true});

// The book a machine belongs to: its Equipment category in the master, else its group (as the save does).
export function assetCoverageKind(asset={}){
 if(asset?.lmv===true)return 'lmv';
 return masterCategory(asset)||assetBookKind(asset);
}
export const activeAsset=asset=>Boolean(asset)&&!asset.sourceMissing&&!RETIRED.test(text(asset.status||asset.equipmentStatus));

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

function bookCoverage(book,roster,answers,assets){
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
 const all=[...rows.values()].sort(byDoor);
 const missing=all.filter(row=>!row.answer);
 const atSite=all.filter(row=>row.atSite);
 return {book:book.key,label:book.label,total:atSite.length,answered:atSite.filter(row=>row.answer).length,
  otherSite:all.filter(row=>!row.atSite).length,remaining:missing.length,missing,complete:missing.length===0,rows:all};
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

// vlbRecords and lmvRecords: the batch's saved cards. elbFleet: the batch's ELB fleet list
// (a line counts once its ELB is saved with a shift status, as Close batch reads it).
export function batchFleetCoverage({assets=[],site,vlbRecords=[],lmvRecords=[],elbFleet=[],elbRecords=[]}={}){
 const index=new Map(assets.map(asset=>[String(asset.id),asset]));
 const roster=siteRoster(assets,site);
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
  vlb:bookCoverage(COVERAGE_BOOKS[0],roster.vehicle,cardAnswers(vlbRecords),index),
  elb:bookCoverage(COVERAGE_BOOKS[1],elbRoster,elbAnswers,index),
  lmv:bookCoverage(COVERAGE_BOOKS[2],roster.lmv,cardAnswers(lmvRecords),index),
 };
 const warnings=Object.values(books).filter(book=>!book.complete).map(coverageWarning);
 return {mode:'warning',books,complete:!warnings.length,warnings};
}

export function coverageWarning(book){
 const shown=book.missing.slice(0,25).map(row=>row.door||row.assetId);
 const more=book.missing.length-shown.length;
 return `${book.label} ${book.answered}/${book.total} machines answered; no card yet: ${shown.join(', ')}${more>0?` and ${more} more`:''}.`;
}
