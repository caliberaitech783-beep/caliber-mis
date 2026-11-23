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
export const allowsLogBookKind=(asset,kind)=>{
 const lmv=isLmv(asset)||asset.lmv===true;
 return kind==='lmv'?lmv:lmv||assetBookKind(asset)===kind;
};
export function assetBookKind(asset={}){
 const category=text(asset.category||asset.equipmentCategory||asset.kind).toLowerCase();
 if(category==='equipment')return 'equipment';if(['vehicle','vehicles'].includes(category))return 'vehicle';
 if(isSurfaceMiner({equipmentGroup:asset.group||asset.equipmentGroup||asset.category,equipmentName:asset.equipmentName||asset.equipment||asset.name,door:asset.door||asset.doorNo}))return 'equipment';
 return /excavator|dozer|grader|loader|drill|shovel|crane|equipment/i.test(text(asset.group||asset.equipmentGroup||asset.equipmentName))?'equipment':'vehicle';
}
