import {isSurfaceMiner} from './surface-miner-hmr.mjs';

// Shared classification for raw masters and the typed options sent to forms.
const text=value=>String(value??'').trim().slice(0,200);
export const isLmv=asset=>text(asset.category||asset.equipmentCategory).toLowerCase()==='lmv';
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
