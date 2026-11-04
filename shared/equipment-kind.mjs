// Shared classification for raw masters and the typed options sent to forms.
const text=value=>String(value??'').trim().slice(0,200);
export function assetBookKind(asset={}){
 const category=text(asset.category||asset.equipmentCategory||asset.kind).toLowerCase();
 if(category==='equipment')return 'equipment';if(['vehicle','vehicles'].includes(category))return 'vehicle';
 return /excavator|dozer|grader|loader|drill|shovel|crane|equipment/i.test(text(asset.group||asset.equipmentGroup||asset.equipmentName))?'equipment':'vehicle';
}
