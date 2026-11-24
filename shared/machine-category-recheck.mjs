// Machine Category Re-check (owner, 24 Nov 2026): "if any vehicle or equipment is in VLB, ELB or LMV, the cards which are
// auto scan or manual entry should validate to show error if any category is mismatch". A new card is stopped on save
// (bookCategoryIssue in shared/equipment-kind.mjs); this rule finds the cards saved before, or whose machine Pulse has
// since moved to another category, so a person can put them right. It reads the Equipment master as it is today.
//
// A card is listed when:
//  - its machine (the door of a VLB or LMV, the equipment of an ELB) is of another category than its book;
//  - on a VLB or LMV, a trip names a loading machine that is not an Equipment.
import {bookCategoryIssue,masterCategory,assetBookKind,BOOK_LABELS} from './equipment-kind.mjs';

const text=value=>String(value??'').trim();
const CATEGORY_LABELS={vehicle:'Vehicle',equipment:'Equipment',lmv:'LMV'};
export const categoryOf=asset=>masterCategory(asset)||assetBookKind(asset);
export const categoryLabel=asset=>{const category=masterCategory(asset);return category?CATEGORY_LABELS[category]:CATEGORY_LABELS[assetBookKind(asset)]+' (no category in the master)';};
const doorOf=asset=>text(asset?.door||asset?.doorNo||asset?.equipmentDoorNo||asset?.registration||asset?.equipmentName||asset?.name);

// card: {kind:'vehicle'|'equipment'|'lmv', assetId, door, trips:[{equipmentId,equipmentName}]}; assets: Map id -> record.
// Returns the problems of the card ([] when it fits the master): {where:'machine'|'trip', label, category, line}.
export function machineCategoryIssues(card,assets){
 const kind=BOOK_LABELS[card?.kind]?card.kind:'vehicle',found=[];
 const asset=assets.get(text(card?.assetId));
 if(asset){
  const line=bookCategoryIssue({...asset,door:doorOf(asset)||text(card.door)},kind);
  if(line)found.push({where:'machine',label:doorOf(asset)||text(card.door),category:categoryLabel(asset),line});
 }
 if(kind!=='equipment'){
  const seen=new Set();
  for(const trip of Array.isArray(card?.trips)?card.trips:[]){
   const id=text(trip?.equipmentId);if(!id||seen.has(id))continue;seen.add(id);
   const machine=assets.get(id);
   if(!machine||categoryOf(machine)==='equipment')continue;
   const label=doorOf(machine)||text(trip.equipmentName);
   found.push({where:'trip',label,category:categoryLabel(machine),line:'Trip loading machine '+label+' is '+categoryLabel(machine)+' in the Equipment Master; a trip is loaded by an Equipment only. Correct the loading machine on the card, or its category in Pulse.'});
  }
 }
 return found;
}
