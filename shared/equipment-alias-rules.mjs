import {cardMachineKey,identifyCardMachine} from './scan-machine-rules.mjs';
import {equipmentDoorNumber} from './equipment-door.mjs';

// Browser-safe alias rules shared by the scan review screen and the server.
// An alias is a written machine label ("L21") that a reviewer mapped once to a Pulse
// equipment record (DEMO21-00179). Attached to the asset as cardAliases it is matched
// by the same door index as a real door, so it never has to be picked again.
const text=value=>String(value??'').normalize('NFKC').trim();

// The written text as the card shows it, capped so a pasted paragraph is never stored.
export const aliasWrittenText=value=>text(value).replace(/\s+/g,' ').slice(0,40);
export const aliasWrittenKey=(value,kind='equipment')=>cardMachineKey(aliasWrittenText(value),kind);
export const assetIdentifiers=row=>[row.door,row.doorNo,equipmentDoorNumber(row),row.registration,row.reg,row.name,row.equipmentName].filter(value=>text(value));

// Decide whether an explicit dropdown choice taught the system something new: the written
// text has a usable machine key and that key is not already one of the asset's own labels.
export function aliasForSelection(written,asset,kind='equipment'){
 const writtenText=aliasWrittenText(written);if(!writtenText||!asset)return null;
 const machine=identifyCardMachine(writtenText,kind==='vehicle'?'vehicle':'trip-body',{allowSuffix:true});
 if(!machine||!machine.hasNumber)return null;
 const key=aliasWrittenKey(writtenText,kind);if(!key)return null;
 if(assetIdentifiers(asset).some(label=>cardMachineKey(label,kind)===key))return null;
 if((asset.cardAliases||[]).some(label=>cardMachineKey(label,kind)===key))return null;
 return {equipmentId:String(asset.id),kind,writtenText,writtenKey:key};
}

// Active aliases resolve a written label. A suspended alias (its key now names a real door of
// another asset at the site) still indexes so the matcher reports the key as ambiguous.
export function attachEquipmentAliases(assets=[],aliases=[],{by='local',statuses=['active','suspended']}={}){
 if(!aliases.length)return assets;
 const index=new Map();
 for(const alias of aliases){
  if(alias.status&&!statuses.includes(alias.status))continue;
  const id=by==='source'?alias.source_id:alias.equipment_id;if(id==null)continue;
  const key=String(id);if(!index.has(key))index.set(key,[]);
  if(!index.get(key).includes(alias.written_text))index.get(key).push(alias.written_text);
 }
 if(!index.size)return assets;
 return assets.map(row=>{const found=index.get(String(row.id));return found?{...row,cardAliases:[...new Set([...(row.cardAliases||[]),...found])]}:row;});
}
