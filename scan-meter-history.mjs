import {scanFieldIssues} from './src/scan-field-review.mjs';
import {formatDisplayDateTime} from './date-time-format.mjs';

const keys=['openingHmr','closingHmr','openingKmr','closingKmr','shiftHours'];
const snapshot=draft=>Object.fromEntries(keys.map(key=>[key,draft?.[key]??'']));
const same=(a,b)=>String(a??'').trim()===String(b??'').trim();
export function recordMeterCorrection(history=[],before={},after={},kind='vehicle',actor='',at=new Date().toISOString()){
 const previous=Array.isArray(history)?history:[];
 if(!keys.some(key=>!same(before[key],after[key])))return previous;
 const issues=Object.fromEntries(Object.entries(scanFieldIssues(before,kind)).filter(([key])=>/^(opening|closing)(Hmr|Kmr)$/.test(key)));
 if(!Object.keys(issues).length&&!previous.length)return previous;
 return [...previous,{before:snapshot(before),after:snapshot(after),issues,by:actor,at}];
}

const reading=value=>value===null||value===undefined||String(value).trim()===''?'blank':String(value);
function meterText(draft,meter){
 const opening=draft['opening'+meter],closing=draft['closing'+meter];
 const delta=reading(opening)!=='blank'&&reading(closing)!=='blank'&&Number.isFinite(Number(opening))&&Number.isFinite(Number(closing))?` (${Number((Number(closing)-Number(opening)).toFixed(3))} ${meter==='Hmr'?'hours':'km'})`:'';
 return `${meter.toUpperCase()}: ${reading(opening)} → ${reading(closing)}${delta}; shift ${reading(draft.shiftHours)} hours`;
}
export function meterCorrectionReport(data={},history=data.meterCorrectionHistory){
 const entries=Array.isArray(history)?history:[],errors=entries.filter(entry=>Object.keys(entry.issues||{}).length);
 if(!errors.length)return {original:'',corrected:''};
 const meters=['Hmr','Kmr'].filter(meter=>errors.some(entry=>Object.keys(entry.issues).some(key=>key.endsWith(meter))));
 const original=[...new Set(errors.flatMap(entry=>meters.filter(meter=>Object.keys(entry.issues).some(key=>key.endsWith(meter))).map(meter=>meterText(entry.before,meter)+': '+[...new Set(Object.entries(entry.issues).filter(([key])=>key.endsWith(meter)).map(([,message])=>message))].join(' '))))].join('\n');
 const latest=entries.at(-1),attribution=[latest.by,latest.at?formatDisplayDateTime(latest.at):''].filter(Boolean).join(' · ');
 const currentIssues=scanFieldIssues(snapshot(data),meters.includes('Kmr')?'vehicle':'equipment');
 const valid=meters.every(meter=>!currentIssues['opening'+meter]&&!currentIssues['closing'+meter]);
 return {original,corrected:valid?meters.map(meter=>meterText(data,meter)).join('\n')+(attribution?'\nSaved correction · '+attribution:''):''};
}
