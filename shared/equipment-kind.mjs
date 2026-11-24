import {isSurfaceMiner} from './surface-miner-hmr.mjs';

// Shared classification for raw masters and the typed options sent to forms.
const text=value=>String(value??'').trim().slice(0,200);
export const isLmv=asset=>text(asset.category||asset.equipmentCategory).toLowerCase()==='lmv';
const assetTypeText=asset=>[
 asset?.equipmentGroup,asset?.group,asset?.vehicleType,asset?.type,asset?.equipmentName,asset?.equipment,asset?.name
].map(text).filter(Boolean).join(' ');
// Owner, 24 Nov 2026: Water Tanker, Diesel Tanker, Service Van, Shift Van, Bus and LMV (LMV driver) carry no trips.
// Their card is always 0 trips: no trip rows, only the meters, and both HMR and KMR are written on it.
// (Until 24 Nov 2026 the two tankers and the service van were KMR only, with HMR left blank.)
export const NO_TRIP_VEHICLE_TYPES=Object.freeze(['Water Tanker','Diesel Tanker','Service Van','Shift Van','Bus','LMV']);
export const isNoTripVehicle=asset=>Boolean(asset)&&(isLmv(asset)||asset.lmv===true||
 /\b(?:diesel\s+tanker|water\s+tanker|service\s+van|shift\s+van|bus(?:es)?)\b/i.test(assetTypeText(asset)));
export const NO_TRIP_VEHICLE_MESSAGE='Water Tanker, Diesel Tanker, Service Van, Shift Van, Bus and LMV carry no trips: remove the trip rows and save the card with 0 trips, with opening and closing HMR and KMR.';
// Owner, 24 Nov 2026: a VLB, ELB or LMV card, scanned or entered by hand, takes only a machine whose Equipment
// category in the Equipment master is that book's: VLB a Vehicle, ELB an Equipment, LMV an LMV. A machine of another
// category is an error that names both, never a guess. (From 9 Nov 2026 an LMV was accepted in every book.)
// The category is read as Pulse keeps it; a record with no category of the three is judged by its group and name, as before.
export const BOOK_LABELS=Object.freeze({vehicle:'VLB',equipment:'ELB',lmv:'LMV'});
const CATEGORY_LABELS={vehicle:'Vehicle',equipment:'Equipment',lmv:'LMV'};
const onCard=kind=>(kind==='vehicle'?'a ':'an ')+BOOK_LABELS[kind]+' card';
export function masterCategory(asset={}){
 const category=text(asset?.category||asset?.equipmentCategory).toLowerCase();
 if(category==='lmv'||asset?.lmv===true)return 'lmv';
 if(category==='equipment')return 'equipment';
 if(['vehicle','vehicles'].includes(category))return 'vehicle';
 return '';
}
const assetLabel=asset=>text(asset?.door||asset?.doorNo||asset?.lmvDoor||asset?.registration||asset?.name||asset?.equipmentName)||'This machine';
// The error for a book given a machine of another category, '' when it fits.
export function bookCategoryIssue(asset,kind){
 if(!asset||!BOOK_LABELS[kind])return '';
 const category=masterCategory(asset),label=assetLabel(asset);
 if(category){
  if(category===kind)return '';
  return label+' is '+CATEGORY_LABELS[category]+' in the Equipment Master, so it cannot be on '+onCard(kind)+' ('+BOOK_LABELS[kind]+' takes '+CATEGORY_LABELS[kind]+' only). Enter it on the '+BOOK_LABELS[category]+' card, or correct the category in Pulse.';
 }
 if(kind==='lmv')return label+' is not LMV in the Equipment Master. An LMV card takes only an LMV machine.';
 const guessed=assetBookKind(asset);
 return guessed===kind?'':label+' has no Equipment category in the Equipment Master and its group reads as '+CATEGORY_LABELS[guessed]+', so it cannot be on '+onCard(kind)+'. Set its category in Pulse.';
}
export const allowsLogBookKind=(asset,kind)=>!bookCategoryIssue(asset,kind);
export function assetBookKind(asset={}){
 const category=text(asset.category||asset.equipmentCategory||asset.kind).toLowerCase();
 if(category==='equipment')return 'equipment';if(['vehicle','vehicles'].includes(category))return 'vehicle';
 if(isSurfaceMiner({equipmentGroup:asset.group||asset.equipmentGroup||asset.category,equipmentName:asset.equipmentName||asset.equipment||asset.name,door:asset.door||asset.doorNo}))return 'equipment';
 return /excavator|dozer|grader|loader|drill|shovel|crane|equipment/i.test(text(asset.group||asset.equipmentGroup||asset.equipmentName))?'equipment':'vehicle';
}
