import {cardMachineKey,identifyCardMachine} from './scan-machine-rules.mjs';
import {equipmentDoorNumber} from './equipment-door.mjs';
import {canonicalSiteName} from './site-location.mjs';
import {assetBookKind} from './equipment-kind.mjs';

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

// All-site letter rules. Every site runs the same scan engines against one database, so a
// mapping made at one site must teach the others too. An approved alias whose written number
// equals the Pulse door number ("L21" -> DEMO21-00179, keys LPC21 and DEMO21) also says what
// the written letter means: written LPC## is Pulse DEMO## everywhere. The rule is derived from
// the alias each time it is read, so approval, revoke and suspension of the alias switch the
// rule on and off at all sites together; nothing is copied per site or per engine.
const siteKey=row=>canonicalSiteName(row?.currentLocation||row?.site||row?.location);
const kindOf=row=>row?.kind||assetBookKind(row||{});
const keyParts=key=>String(key||'').match(/^([A-Z]+)(\d+)$/);
// Real Pulse door labels only (with a number), never an alias or a registration.
export const realDoorLabels=row=>[row?.door,row?.doorNo,equipmentDoorNumber(row||{})].filter(value=>text(value)&&/\d/.test(value));

// The letter rule an alias teaches, or null when the numbers differ or the letters already agree.
export function letterRuleForAlias({kind='equipment',written_key,writtenKey,door}={}){
 const written=keyParts(written_key??writtenKey),target=keyParts(cardMachineKey(door,kind));
 if(!written||!target||written[2]!==target[2]||written[1]===target[1])return null;
 return {kind,writtenCode:written[1],targetPrefix:target[1]};
}

// rows: active aliases joined to their Pulse record ({id,kind,written_key,written_text,site,record_data}).
export function deriveLetterRules(rows=[]){
 const rules=new Map();
 for(const row of rows){
  const record=row.record_data||{};if(record.sourceMissing)continue;
  const rule=realDoorLabels(record).map(door=>letterRuleForAlias({kind:row.kind,written_key:row.written_key,door})).find(Boolean);if(!rule)continue;
  const id=[rule.kind,rule.writtenCode,rule.targetPrefix].join(':');
  if(!rules.has(id))rules.set(id,{id,...rule,sources:[]});
  rules.get(id).sources.push({aliasId:row.id,writtenText:row.written_text,equipmentId:String(row.equipment_id??''),door:realDoorLabels(record)[0],site:text(record.currentLocation||record.site||record.location)||text(row.site)});
 }
 const list=[...rules.values()];
 // Two rules for one written letter (L -> DEMO and L -> U) are both kept: where both targets
 // exist at a site the written label matches two machines and the card goes to review.
 for(const rule of list)rule.conflicts=list.filter(other=>other!==rule&&other.kind===rule.kind&&other.writtenCode===rule.writtenCode).map(other=>other.targetPrefix);
 return list;
}

// Give each Pulse record the written labels the letter rules imply at its current site. A real
// door or a saved alias of another record at the same site always wins: the rule label is then
// left off, so a rule can never redirect a machine that is already known by that label.
export function attachLetterRules(assets=[],rules=[]){
 if(!rules.length||!assets.length)return assets;
 const taken=new Set(),slot=(kind,site,key)=>kind+'\0'+site+'\0'+key;
 for(const row of assets){if(row.sourceMissing)continue;const kind=kindOf(row),site=siteKey(row);for(const label of [...realDoorLabels(row),...(Array.isArray(row.cardAliases)?row.cardAliases:[])]){const key=cardMachineKey(label,kind);if(key)taken.add(slot(kind,site,key));}}
 let changed=false;
 const result=assets.map(row=>{
  if(row.sourceMissing)return row;
  const kind=kindOf(row),site=siteKey(row),extra=[];
  for(const door of realDoorLabels(row)){
   const parts=keyParts(cardMachineKey(door,kind));if(!parts)continue;
   for(const rule of rules){
    if(rule.kind!==kind||rule.targetPrefix!==parts[1])continue;
    const label=rule.writtenCode+parts[2];
    if(!taken.has(slot(kind,site,label))&&!extra.includes(label))extra.push(label);
   }
  }
  if(!extra.length)return row;
  changed=true;
  return {...row,cardAliases:[...new Set([...(row.cardAliases||[]),...extra])],cardRuleAliases:extra};
 });
 return changed?result:assets;
}
