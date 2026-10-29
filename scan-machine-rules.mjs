import {canonicalSiteName} from './site-location.mjs';
import {equipmentDoorNumber} from './equipment-door.mjs';

export const VEHICLE_MACHINE_RULES=[
 {code:'V',label:'Volvo',aliases:['V','VOLVO']},
 {code:'E',label:'Eicher',aliases:['E','EICHER']},
 {code:'S',label:'Scania',aliases:['S','SCANIA']},
 {code:'H',label:'Haulpak Dumper',aliases:['H','HAULPAK','HAULPAK DUMPER']},
];
export const EQUIPMENT_MACHINE_RULES=[
 {code:'VPC',label:'VPC',aliases:['V','VPC','VOLVO']},
 {code:'TPC',label:'TPC',aliases:['T','TPC','EICHER']},
 {code:'SPC',label:'SPC',aliases:['S','SPC','SCANIA']},
 {code:'LPC',label:'LPC',aliases:['L','LPC','HAULPAK','HAULPAK DUMPER']},
 {code:'D',label:'Dozer',aliases:['D','DOZER']},
 {code:'G',label:'Grader',aliases:['G','GRADER']},
 {code:'PL',label:'Pay Loader',aliases:['PL','PAY LOADER','PAYLOADER']},
 {code:'H',label:'Hydra',aliases:['H','HYDRA']},
];
const prefixKey=value=>String(value||'').toUpperCase().replace(/[\s._/-]/g,'');
const text=value=>String(value??'').normalize('NFKC').trim();
const contextFor=kind=>kind==='vehicle'?'vehicle':'equipment';
export function identifyCardMachine(value,kind='equipment',{allowSuffix=false}={}){
 const original=text(value),withoutNumberLabel=original.replace(/\b(?:NUMBER|NO\.?)[ \t]*[:#=-]?[ \t]*(?=\d)/i,'');
 const input=(allowSuffix?(withoutNumberLabel.match(/^([A-Z][A-Z ._/-]*?\d+)(?:\s*[-·–—(].*)?$/i)?.[1]||withoutNumberLabel):withoutNumberLabel).toUpperCase();
 const numbered=input.match(/^([A-Z][A-Z ._/-]*?)[ \t]*(\d+)$/);
 const prefix=numbered?numbered[1]:/^[A-Z][A-Z ._/-]*$/.test(input)?input:'';
 const rule=(contextFor(kind)==='vehicle'?VEHICLE_MACHINE_RULES:EQUIPMENT_MACHINE_RULES).find(r=>r.aliases.some(alias=>prefixKey(alias)===prefixKey(prefix)));
 if(!rule)return null;
 const number=numbered?.[2]||'';
 return {original,context:contextFor(kind),code:rule.code,label:rule.label,number,hasNumber:Boolean(number),canonical:rule.code+number,key:number?rule.code+number.replace(/^0+(?=\d)/,''):''};
}
export function cardMachineKey(value,kind='equipment',{allowSuffix=true}={}){
 const identified=identifyCardMachine(value,kind,{allowSuffix});
 if(identified)return identified.key;
 const legacy=text(value).toUpperCase().match(/^([A-Z]{1,5})\s*[-/]?\s*(\d+)(?=$|[\s(·–—-])/);
 return legacy?legacy[1]+legacy[2].replace(/^0+(?=\d)/,''):text(value).toUpperCase().replace(/[^A-Z0-9]/g,'');
}
const identifiers=row=>{
 const doors=[row.door,row.doorNo,equipmentDoorNumber(row)].filter(value=>value&&/\d/.test(value));
 return doors.length?doors:[row.registration,row.reg,row.name,row.equipmentName].filter(Boolean);
};
// Options/master arrays are replaced on refresh. Index each stable array once,
// rather than rescanning the entire fleet for every trip on each keystroke.
const masterIndexes=new WeakMap();
function masterIndex(rows,site,kind){
 let indexes=masterIndexes.get(rows);if(!indexes){indexes=new Map();masterIndexes.set(rows,indexes);}
 const cacheKey=kind+'\0'+canonicalSiteName(site);if(indexes.has(cacheKey))return indexes.get(cacheKey);
 const index=new Map();
 for(const row of rows){
  if(row.kind&&row.kind!==kind||site&&canonicalSiteName(row.currentLocation||row.site||row.location)!==canonicalSiteName(site))continue;
  for(const identifier of identifiers(row)){const key=cardMachineKey(identifier,kind);if(!key)continue;if(!index.has(key))index.set(key,new Set());index.get(key).add(row);}
 }
 indexes.set(cacheKey,index);return index;
}
export function matchCardMachine(rows=[],value,site='',kind='equipment'){
 const machine=identifyCardMachine(value,kind,{allowSuffix:true});
 if(machine&&!machine.hasNumber)return {machine,matches:[],match:null,status:'missing-number'};
 if(/^\d+$/.test(text(value)))return {machine:null,matches:[],match:null,status:'missing-prefix'};
 const target=cardMachineKey(value,kind);
 const matches=target?[...(masterIndex(rows,site,kind).get(target)||[])]:[];
 return {machine,matches,match:matches.length===1?matches[0]:null,status:matches.length===1?'matched':matches.length>1?'ambiguous':'not-found'};
}
export const resolvedMachineName=row=>text(row.door||row.doorNo||equipmentDoorNumber(row)||row.name||row.equipmentName);
export function scannedEquipmentName(value,assets=[],site=''){
 const result=matchCardMachine(assets,value,site,'equipment');
 return result.match?resolvedMachineName(result.match):text(value);
}
export function normalizeScanEquipmentRows(input={},assets=[]){
 if(input.machineNotationRuleVersion!==1)return input;
 const normalize=rows=>(rows||[]).map(row=>({...row,equipmentName:scannedEquipmentName(row.equipmentName,assets,input.location)}));
 return {...input,trips:normalize(input.trips),scanMachineSummary:normalize(input.scanMachineSummary)};
}
export function scanEquipmentMatchIssues(input={},assets=[]){
 if(input.machineNotationRuleVersion!==1)return {};
 const issues={};
 for(const [collection,rows]of [['trips',input.trips||[]],['scanMachineSummary',input.scanMachineSummary||[]]])for(const [index,row]of rows.entries()){
  if(!text(row.equipmentName))continue;
  const result=matchCardMachine(assets,row.equipmentName,input.location,'equipment');if(result.match)continue;
  const reason=result.status==='missing-number'?'machine number is missing':result.status==='missing-prefix'?'M/type prefix is missing':result.status==='ambiguous'?'multiple equipment master records match':'no equipment master record matches';
  issues[collection==='trips'?`trips.${index}.equipmentName`:'scanMachineSummary']=`Check ${text(row.equipmentName)}: ${reason} at the selected location.`;
 }
 return issues;
}
export function cardMachineHint(value,kind){
 const result=identifyCardMachine(value,kind,{allowSuffix:true});return result?`Identified: ${result.label}${result.number?' · No. '+result.number:' · enter the machine number'}`:'';
}
// A derived parsing aid only. The original OCR text and field values stay intact.
export function compactScanEquipmentReferences(line){
 return String(line).replace(/\b(PAY[ -]*LOADER|HAULPAK[ -]*DUMPER|HAULPAK|VOLVO|EICHER|SCANIA|DOZER|GRADER|HYDRA|V[ .]*P[ .]*C|T[ .]*P[ .]*C|S[ .]*P[ .]*C|L[ .]*P[ .]*C|PL|[VTSLDGH])[ \t]*[-/]?[ \t]*(\d+)\b/gi,(original,prefix,number)=>/^[VTSL]$/i.test(prefix)?prefix.toUpperCase()+number:identifyCardMachine(prefix+number,'equipment')?.canonical||original);
}
