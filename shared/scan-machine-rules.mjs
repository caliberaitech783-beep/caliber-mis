import {assetBookKind} from './equipment-kind.mjs';
import {resolveTripEquipment} from './trip-equipment-validation.mjs';
import {canonicalSiteName} from './site-location.mjs';
import {equipmentDoorNumber} from './equipment-door.mjs';
import {tripEquipmentRequired,combineMachineSummary} from './trip-card-rules.mjs';
import {normalizeScannedTime} from './scan-clock.mjs';

export const VEHICLE_MACHINE_RULES=[
 {code:'V',label:'Volvo',aliases:['V','VOLVO','VOLVO TIPPER','VOLVO TIPPERS']},
 {code:'E',label:'Eicher',aliases:['E','EICHER']},
 {code:'S',label:'Scania',aliases:['S','SCANIA']},
 {code:'H',label:'Haulpak Dumper',aliases:['HP','H','HAULPAK','HAULPAK DUMPER']},
];
export const EQUIPMENT_MACHINE_RULES=[
 {code:'VPC',label:'VPC',aliases:['V','VPC','VOLVO']},
 {code:'TPC',label:'TPC',aliases:['T','TA','TATA','TPC','EICHER']},
 {code:'SPC',label:'SPC',aliases:['S','SPC','SCANIA']},
 {code:'LPC',label:'LPC',aliases:['L','LPC']},
 {code:'LPC',label:'Haulpak Dumper',aliases:['HP','HAULPAK','HAULPAK DUMPER']},
 {code:'DEMO',label:'DEMO',aliases:['DE','DEMO']},
 {code:'D',label:'Dozer',aliases:['D','DOZER']},
 {code:'G',label:'Grader',aliases:['G','GRADER']},
 {code:'PL',label:'Pay Loader',aliases:['PL','PAY LOADER','PAYLOADER']},
 {code:'H',label:'Hydra',aliases:['H','HYDRA']},
];
const prefixKey=value=>String(value||'').toUpperCase().replace(/[\s._:/-]/g,'');
const text=value=>String(value??'').normalize('NFKC').trim();
const contextFor=kind=>kind==='vehicle'?'vehicle':'equipment';
// Preserve legacy body-H interpretation for existing version-one scan drafts.
const LEGACY_TRIP_BODY_MACHINE_RULES=EQUIPMENT_MACHINE_RULES.map(rule=>({...rule,aliases:rule.code==='TPC'?[...rule.aliases,'E']:rule.code==='LPC'?[...rule.aliases,'H']:rule.code==='H'?rule.aliases.filter(alias=>alias!=='H'):rule.aliases}));
const TRIP_BODY_MACHINE_RULES=EQUIPMENT_MACHINE_RULES.map(rule=>({...rule,aliases:rule.code==='TPC'?[...rule.aliases,'E']:rule.aliases}));
export function identifyCardMachine(value,kind='equipment',{allowSuffix=false}={}){
 const original=text(value),withoutNumberLabel=original.replace(/\b(?:NUMBER|NO\.?)[ \t]*[:#=-]?[ \t]*(?=\d)/i,'');
 const input=(allowSuffix?(withoutNumberLabel.match(/^([A-Z][A-Z ._:/-]*?\d+)(?:\s*[-·–—(].*)?$/i)?.[1]||withoutNumberLabel):withoutNumberLabel).toUpperCase();
 const numbered=input.match(/^([A-Z][A-Z ._:/-]*?)[ \t]*(\d+)$/);
 const prefix=numbered?numbered[1]:/^[A-Z][A-Z ._:/-]*$/.test(input)?input:'';
 const rule=(kind==='trip-body-legacy'?LEGACY_TRIP_BODY_MACHINE_RULES:kind==='trip-body'?TRIP_BODY_MACHINE_RULES:contextFor(kind)==='vehicle'?VEHICLE_MACHINE_RULES:EQUIPMENT_MACHINE_RULES).find(r=>r.aliases.some(alias=>prefixKey(alias)===prefixKey(prefix)));
 if(!rule)return null;
 const number=numbered?.[2]||'';
 return {original,context:contextFor(kind),code:rule.code,label:rule.label,number,hasNumber:Boolean(number),canonical:rule.code+number,key:number?rule.code+number.replace(/^0+(?=\d)/,''):''};
}
export function cardMachineKey(value,kind='equipment',{allowSuffix=true}={}){
 const identified=identifyCardMachine(value,kind,{allowSuffix});
 if(identified)return identified.key;
 const legacy=text(value).toUpperCase().match(/^([A-Z][A-Z ._:/-]*?)\s*(\d+)(?=$|[\s(·–—-])/);
 return legacy?prefixKey(legacy[1])+legacy[2].replace(/^0+(?=\d)/,''):text(value).toUpperCase().replace(/[^A-Z0-9]/g,'');
}
// The key a written door has when its first digit 1 is really the slash or dash
// after the letters (V/334 read as V1334 -> V334, S/01 read as S101 -> S1).
// Needs at least two digits after that 1.
export function separatorCorrectedKey(value,kind='equipment'){
 const parts=cardMachineKey(value,kind).match(/^([A-Z]+)1(\d{2,})$/);
 return parts?parts[1]+parts[2].replace(/^0+(?=\d)/,''):'';
}
// Approved card aliases (for example written "L21" for door DEMO21-00179) index beside the real door.
const identifiers=row=>{
 const doors=[row.door,row.doorNo,equipmentDoorNumber(row)].filter(value=>value&&/\d/.test(value));
 const aliases=Array.isArray(row.cardAliases)?row.cardAliases.filter(Boolean):[];
 return [...(doors.length?doors:[row.registration,row.reg,row.name,row.equipmentName].filter(Boolean)),...aliases];
};
const masterIdentifiers=row=>{
 const doors=[row.door,row.doorNo,equipmentDoorNumber(row)].filter(value=>value&&/\d/.test(value));
 return doors.length?doors:[row.registration,row.reg,row.name,row.equipmentName].filter(Boolean);
};
// Options/master arrays are replaced on refresh. Index each stable array once,
// rather than rescanning the entire fleet for every trip on each keystroke.
const masterIndexes=new WeakMap();
function masterIndex(rows,site,kind){
 let indexes=masterIndexes.get(rows);if(!indexes){indexes=new Map();masterIndexes.set(rows,indexes);}
 const cacheKey=kind+'\0'+canonicalSiteName(site);if(indexes.has(cacheKey))return indexes.get(cacheKey);
 const index=new Map(),masterDoors=new Map();
 for(const row of rows){
  if(kind==='equipment'&&assetBookKind(row)!=='equipment'||row.kind&&row.kind!==kind||site&&canonicalSiteName(row.currentLocation||row.site||row.location)!==canonicalSiteName(site))continue;
  for(const identifier of identifiers(row)){const key=cardMachineKey(identifier,kind);if(!key)continue;if(!index.has(key))index.set(key,new Set());index.get(key).add(row);}
  for(const identifier of masterIdentifiers(row)){const key=cardMachineKey(identifier,kind);if(!key)continue;if(!masterDoors.has(key))masterDoors.set(key,new Set());masterDoors.get(key).add(row);}
 }
 const result={all:index,masterDoors};indexes.set(cacheKey,result);return result;
}
export function matchCardMachine(rows=[],value,site='',kind='equipment'){
 const machine=identifyCardMachine(value,kind,{allowSuffix:true});
 if(machine&&!machine.hasNumber)return {machine,matches:[],match:null,status:'missing-number'};
 if(/^\d+$/.test(text(value)))return {machine:null,matches:[],match:null,status:'missing-prefix'};
 const target=cardMachineKey(value,kind),indexes=masterIndex(rows,site,kind),index=indexes.all;
 // A literal door in Equipment Master always wins over a learned alias using
 // the same written key.
 const exactMaster=target?[...(indexes.masterDoors.get(target)||[])]:[];
 const matches=exactMaster.length?exactMaster:target?[...(index.get(target)||[])]:[];
 if(matches.length)return {machine,matches,match:matches.length===1?matches[0]:null,status:matches.length===1?'matched':'ambiguous'};
 // The slash/dash after the letters is often read as a 1 (V/334 -> V1334). When
 // no door answers the read number and exactly one door answers it without that
 // leading 1, the card meant that door.
 const corrected=separatorCorrectedKey(value,kind);
 if(corrected){
  const fixed=[...(indexes.masterDoors.get(corrected)||index.get(corrected)||[])];
  if(fixed.length===1)return {machine,matches:fixed,match:fixed[0],status:'separator',correctedKey:corrected};
 }
 // Recover one omitted or duplicated digit only inside the selected site and
 // fleet prefix. Exact matches above always win, and ambiguity never guesses.
 const parts=kind==='vehicle'&&target.match(/^([A-Z]+)(\d+)$/),near=[];
 if(parts)for(const [candidate,assets] of index){
  const other=candidate.match(/^([A-Z]+)(\d+)$/);if(!other||other[1]!==parts[1]||Math.abs(other[2].length-parts[2].length)!==1)continue;
  const [shorter,longer]=other[2].length<parts[2].length?[other[2],parts[2]]:[parts[2],other[2]];
  if([...longer].some((_,i)=>longer.slice(0,i)+longer.slice(i+1)===shorter))near.push(...assets);
 }
 const recovered=[...new Set(near)];
 return {machine,matches:recovered,match:recovered.length===1?recovered[0]:null,status:recovered.length===1?'recovered':recovered.length>1?'ambiguous':'not-found'};
}
// True when only an approved card alias on the record answers the written key (no real door does).
export function resolvedByAlias(row,value,kind='equipment'){
 const aliases=Array.isArray(row?.cardAliases)?row.cardAliases.filter(Boolean):[];if(!aliases.length)return false;
 const target=cardMachineKey(value,kind);if(!target)return false;
 const doors=[row.door,row.doorNo,equipmentDoorNumber(row)].filter(v=>v&&/\d/.test(v));
 const real=doors.length?doors:[row.registration,row.reg,row.name,row.equipmentName].filter(Boolean);
 return !real.some(label=>cardMachineKey(label,kind)===target)&&aliases.some(label=>cardMachineKey(label,kind)===target);
}
// True when the written key reached the record only through an all-site letter rule
// (written L## is Pulse DEMO## everywhere), not through an alias saved on this machine.
export function resolvedByLetterRule(row,value,kind='equipment'){
 const rule=Array.isArray(row?.cardRuleAliases)?row.cardRuleAliases:[];if(!rule.length)return false;
 const target=cardMachineKey(value,kind);if(!target||!resolvedByAlias(row,value,kind))return false;
 const saved=(row.cardAliases||[]).filter(label=>label&&!rule.includes(label));
 return rule.some(label=>cardMachineKey(label,kind)===target)&&!saved.some(label=>cardMachineKey(label,kind)===target);
}
export const resolvedMachineName=row=>text(row.door||row.doorNo||equipmentDoorNumber(row)||row.name||row.equipmentName);
export function siteEquipmentOptions(assets=[],site=''){
 const selectedSite=canonicalSiteName(site);
 if(!selectedSite)return [];
 return assets.filter(row=>!row.sourceMissing&&assetBookKind(row)==='equipment'&&canonicalSiteName(row.currentLocation||row.site||row.location)===selectedSite);
}
// Keep manual selections separate from OCR-derived names and summary inference.
export function selectTripEquipment(row={},equipmentId='',assets=[],site=''){
 const asset=siteEquipmentOptions(assets,site).find(item=>String(item.id)===String(equipmentId));
 const original=row.originalEquipmentName||row.equipmentNotation?.original||row.equipmentName||'';
 const resolved=asset?resolvedMachineName(asset):'';
 return {...row,equipmentId:asset?String(asset.id):'',equipmentName:resolved,equipmentSource:'master-selection',originalEquipmentName:original,equipmentNotation:{original,resolved}};
}
// A correction to an OCR label applies to the same uncorrected label throughout
// this card, including its printed summary. Explicit choices and counts stay intact.
export function correctMatchingTripEquipment(draft,collection,index,equipmentId,assets=[]){
 const source=draft[collection]?.[index];if(!source)return draft;
 const chosen=selectTripEquipment(source,equipmentId,assets,draft.location);
 const original=source.originalEquipmentName||source.equipmentNotation?.original||source.equipmentName||'';
 const key=cardMachineKey(original,'equipment');
 const replace=(row,i,name)=>{
  if(name===collection&&i===index)return chosen;
  if(!chosen.equipmentId||row.equipmentSource==='master-selection')return row;
  const label=row.originalEquipmentName||row.equipmentNotation?.original||row.equipmentName||'';
  return key&&cardMachineKey(label,'equipment')===key?selectTripEquipment(row,equipmentId,assets,draft.location):row;
 };
 return {...draft,trips:(draft.trips||[]).map((row,i)=>replace(row,i,'trips')),scanMachineSummary:(draft.scanMachineSummary||[]).map((row,i)=>replace(row,i,'scanMachineSummary'))};
}
export function tripEquipmentSelectionValue(row={},assets=[],site='',version=2){
 const available=siteEquipmentOptions(assets,site);
 if(row.equipmentSource==='master-selection')return available.some(asset=>String(asset.id)===String(row.equipmentId))?String(row.equipmentId):'';
 // Older saved/OCR rows may contain only the shortened equipment name.
 const normalized=scannedTripEquipmentRow(row,assets,site,version);
 const match=resolveTripEquipment(normalized,available,site);
 return match.error?'':match.equipmentId;
}
export function scannedEquipmentName(value,assets=[],site=''){
 const result=matchCardMachine(assets,value,site,'equipment');
 return result.match?resolvedMachineName(result.match):text(value);
}
export function normalizeScanEquipmentRows(input={},assets=[]){
 if(input.machineNotationRuleVersion!==1){const summary=combineMachineSummary(input.scanMachineSummary);return summary.length===(input.scanMachineSummary||[]).length?input:{...input,scanMachineSummary:summary};}
 const normalize=rows=>(rows||[]).map(row=>scannedTripEquipmentRow(row,assets,input.location,input.tripBodyRuleVersion||1));
 return {...input,trips:normalize(input.trips),scanMachineSummary:combineMachineSummary(normalize(input.scanMachineSummary))};
}
// The loading hour read twice (rule of 23 Nov 2026). On the trip card the hour is written
// right against the machine number in the narrow NO column, and the reader sometimes counts
// it twice: "T | 65 | 8:38" comes back as T658 loaded at 08:38, "T | 65 | 10:08" as T6510.
// A row is put back to the real machine only when all of this holds:
//  - the number as read is no machine at the card's site (no door, alias or other rule),
//  - it ends in that row's own loading hour,
//  - without those digits it is exactly one real door at the site (never an alias), and
//  - the card itself confirms the machine: its machine-wise summary lists it, or a second
//    row loaded in another hour comes down to the same machine.
// Anything less is left as read for the reviewer. The written text is kept in the notation.
const hourDigitForms=time=>{
 const clock=String(normalizeScannedTime(typeof time==='string'?time:'')||'').match(/^(\d{2}):\d{2}$/);if(!clock)return [];
 const hour=Number(clock[1]),twelve=hour%12||12;
 return [...new Set([String(hour),String(twelve),String(hour).padStart(2,'0'),String(twelve).padStart(2,'0')])].map(digits=>({digits,hour}));
};
const machineLabelParts=value=>{const parts=text(value).toUpperCase().replace(/[\s._/-]/g,'').match(/^([A-Z]+)(\d+)$/);return parts?{prefix:parts[1],digits:parts[2]}:null;};
const realDoorMatch=(assets,label,site)=>{const result=matchCardMachine(assets,label,site,'equipment');return result.status==='matched'&&!resolvedByAlias(result.match,label)?result.match:null;};
function hourGluedCandidate(row,assets,site,version){
 if(!row||row.equipmentSource==='master-selection')return null;
 const value=text(row.equipmentName);if(!value)return null;
 const lookup=tripBodyEquipmentReference(value,version);
 // A label that already answers to one machine, or to several, is never rewritten.
 const literal=matchCardMachine(assets,lookup,site,'equipment');if(literal.match||literal.matches.length)return null;
 const parts=machineLabelParts(lookup);if(!parts)return null;
 const found=new Map();
 for(const time of [row.writtenLoadingTime,row.loadingTime])for(const form of hourDigitForms(time)){
  if(parts.digits.length<=form.digits.length||!parts.digits.endsWith(form.digits))continue;
  const asset=realDoorMatch(assets,parts.prefix+parts.digits.slice(0,-form.digits.length),site);
  if(asset)found.set(String(asset.id),{asset,hour:form.hour,digits:form.digits,original:row.equipmentNotation?.original||value});
 }
 return found.size===1?[...found.values()][0]:null;
}
export function correctHourGluedMachines(input={},assets=[]){
 if(input.machineNotationRuleVersion!==1||!text(input.location)||!Array.isArray(input.trips)||input.timeMode==='without')return input;
 const site=input.location,version=input.tripBodyRuleVersion||1;
 const candidates=input.trips.map(row=>hourGluedCandidate(row,assets,site,version));
 if(!candidates.some(Boolean))return input;
 const inSummary=new Set((input.scanMachineSummary||[]).map(row=>{
  if(row?.equipmentSource==='master-selection'&&row.equipmentId)return String(row.equipmentId);
  const value=text(row?.equipmentName);if(!value)return '';
  const asset=realDoorMatch(assets,tripBodyEquipmentReference(value,version),site);
  return asset?String(asset.id):'';
 }).filter(Boolean));
 const hours=new Map();
 for(const candidate of candidates)if(candidate){const id=String(candidate.asset.id);if(!hours.has(id))hours.set(id,new Set());hours.get(id).add(candidate.hour);}
 let changed=false;
 const trips=input.trips.map((row,index)=>{
  const candidate=candidates[index];if(!candidate)return row;
  const id=String(candidate.asset.id);if(!inSummary.has(id)&&hours.get(id).size<2)return row;
  changed=true;
  const resolved=resolvedMachineName(candidate.asset);
  return {...row,equipmentName:resolved,equipmentNotation:{original:candidate.original,resolved,hourGlued:candidate.digits}};
 });
 return changed?{...input,trips}:input;
}
// The label a trip row still has to be matched by: nothing for an explicit dropdown choice,
// the corrected machine for a row put back by the loading-hour rule, else the text as read.
export const tripRowWrittenMachine=row=>row?.equipmentSource==='master-selection'?'':row?.equipmentNotation?.hourGlued?text(row.equipmentName):text(row?.equipmentNotation?.original||row?.equipmentName);
export function scannedTripEquipmentRow(row={},assets=[],site='',version=2){
 const value=text(row.equipmentName),prior=row.equipmentNotation;
 const locationMatch=resolveTripEquipment(row,assets,site);
 if(row.equipmentSource==='master-selection'){
  if(locationMatch.error)return row;
  const record=assets.find(asset=>String(asset.id)===locationMatch.equipmentId);
  return {...row,...locationMatch,equipmentName:resolvedMachineName(record)};
 }
 if(!locationMatch.error&&/^(?:U|TA|TATA)[ ._/-]*[0-9]+$/i.test(value)){const record=assets.find(r=>String(r.id)===locationMatch.equipmentId);const resolved=record?resolvedMachineName(record):locationMatch.equipmentName;return {...row,...locationMatch,equipmentName:resolved,equipmentNotation:{original:row.originalEquipmentName||prior?.original||value,resolved}};}
 // A resolved master H door is Hydra, not fresh handwritten H shorthand.
 if(prior&&value===prior.resolved)return {...row,equipmentName:scannedEquipmentName(value,assets,site)};
 const lookup=tripBodyEquipmentReference(value,version);
 const result=site?matchCardMachine(assets,lookup,site,'equipment'):{match:null};
 const resolved=result.match?resolvedMachineName(result.match):lookup;
 const alias=Boolean(result.match)&&resolvedByAlias(result.match,lookup);
 const rule=alias&&resolvedByLetterRule(result.match,lookup);
 return {...row,equipmentName:resolved,equipmentNotation:alias?{original:value,resolved,alias:true,...(rule?{letterRule:true}:{})}:{original:value,resolved}};
}
export function tripBodyEquipmentReference(value,version=2){
 if(value==null)return value;
 const machine=identifyCardMachine(value,version===1?'trip-body-legacy':'trip-body');
 return machine?.hasNumber?machine.code==='H'?'Hydra'+machine.number:machine.canonical:text(value);
}
export function scanEquipmentMatchIssues(input={},assets=[]){
 if(input.machineNotationRuleVersion!==1)return {};
 input=normalizeScanEquipmentRows(input,assets);
 const issues={};
 for(const [collection,rows]of [['trips',input.trips||[]],['scanMachineSummary',input.scanMachineSummary||[]]])for(const [index,row]of rows.entries()){
  if(collection==='trips'&&!tripEquipmentRequired(row,input.timeMode))continue;
  if(!text(row.equipmentName))continue;
  if(row.equipmentSource==='master-selection'){
   const match=resolveTripEquipment(row,assets,input.location);
   if(match.error)issues[collection==='trips'?`trips.${index}.equipmentName`:'scanMachineSummary']=match.error;
   continue;
  }
  const result=matchCardMachine(assets,row.equipmentName,input.location,'equipment');if(result.match)continue;
  const reason=result.status==='missing-number'?'machine number is missing':result.status==='missing-prefix'?'M/type prefix is missing':result.status==='ambiguous'?'multiple equipment master records match':'no equipment master record matches';
  issues[collection==='trips'?`trips.${index}.equipmentName`:'scanMachineSummary']=`Check ${text(row.equipmentName)}: ${reason} at the selected location.`;
 }
 return issues;
}
export function cardMachineHint(value,kind){
 const result=identifyCardMachine(value,kind,{allowSuffix:true});
 if(!result)return '';
 if(!result.number)return `Identified: ${result.label} · enter the machine number`;
 const displayCode=kind==='vehicle'?{V:'V',H:'HP'}[result.code]:null;
 return `Identified: ${result.label} · ${displayCode?displayCode+result.number:'No. '+result.number}`;
}
// Review line for a loading row that resolved through an approved alias instead of a real door.
export function aliasMachineHint(row={}){
 const notation=row.equipmentNotation;
 if(notation?.hourGlued&&notation.original)return `Written: ${notation.original} · read as ${notation.resolved}: the ${notation.hourGlued} on the end is the loading hour`;
 if(!notation?.alias||!notation.original)return '';
 const machine=identifyCardMachine(notation.original,'trip-body',{allowSuffix:true});
 return `Written: ${notation.original}${machine?' · Identified: '+machine.label+(machine.number?' · No. '+machine.number:''):''} · mapped by ${notation.letterRule?'all-site letter rule':'saved alias'}`;
}
// A derived parsing aid only. The original OCR text and field values stay intact.
export function compactScanEquipmentReferences(line){
 return String(line).replace(/\b(PAY[ -]*LOADER|HAULPAK[ -]*DUMPER|HAULPAK|VOLVO|EICHER|SCANIA|DOZER|GRADER|HYDRA|DEMO|DE|V[ .]*P[ .]*C|T[ .]*P[ .]*C|S[ .]*P[ .]*C|L[ .]*P[ .]*C|PL|HP|[VETSLDGH])[ \t]*[-/]?[ \t]*(\d+)\b/gi,(original,prefix,number)=>/^HYDRA$/i.test(prefix)?'Hydra'+number:/^(?:[VETSLH]|HP)$/i.test(prefix)?prefix.toUpperCase()+number:identifyCardMachine(prefix+number,'equipment')?.canonical||original);
}
