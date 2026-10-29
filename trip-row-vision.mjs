import {locateTripCard,cropHandwriting} from './trip-card-template.mjs';
import {loadHandwritingModel} from './handwritten-card-ocr.mjs';
import {tripClockForShift} from './trip-card-rules.mjs';
export function cleanTripCell(type,text){
 const v=String(text||'').trim().replace(/^["'‘’“”]+|["'‘’“”.,;]+$/g,'').trim();
 if(type==='type')return /^[A-Za-z]{1,3}$/.test(v)?v.toUpperCase():'';
 if(type==='time'){const m=v.match(/^(\d{1,2})\s*[:.; ]\s*(\d{1,2})$/);return m&&Number(m[1])<24&&Number(m[2])<60?m[1].padStart(2,'0')+':'+m[2].padStart(2,'0'):'';}
 const n=v.replace(/\s/g,'');return /^\d{1,5}$/.test(n)&&Number(n)>0?String(Number(n)):'';
}
export async function readTripGrid(bytes,text,{recognize}={}){
 const paper=await locateTripCard(bytes,text);if(!paper)return null;
 const {RawImage}=await import('@huggingface/transformers'),model=recognize||await loadHandwritingModel();
 const read=async(region,type)=>{const tight=cropHandwriting(paper,region,{minInk:30});if(!tight)return {present:false,value:'',text:''};const loose=cropHandwriting(paper,region,{tight:false,minInk:30});
  const a=(await model(await RawImage.fromBlob(new Blob([tight],{type:'image/png'})),{max_new_tokens:16}))?.[0]?.generated_text||'',b=(await model(await RawImage.fromBlob(new Blob([loose],{type:'image/png'})),{max_new_tokens:16}))?.[0]?.generated_text||'';
  const first=cleanTripCell(type,a),second=cleanTripCell(type,b),conflict=Boolean(first&&second&&first!==second);return {present:true,value:conflict?'':first||second,text:a,alternate:b,conflict};};
 const rows=[],summary=[];
 for(let half=0;half<2;half++)for(let row=0;row<12;row++){
  const dx=half*.5,y=.444+row*.0451,y1=y+.042;
  const equipmentType=await read([dx+.07,dx+.12,y,y1],'type'),equipmentNo=await read([dx+.13,dx+.208,y,y1],'number'),loading=await read([dx+.22,dx+.346,y,y1],'time'),unloading=await read([dx+.36,dx+.489,y,y1],'time');
  if([equipmentType,equipmentNo,loading,unloading].some(c=>c.present))rows.push({rowNumber:half*12+row+1,equipmentType,equipmentNo,loading,unloading});
 }
 for(let half=0;half<2;half++)for(let row=0;row<4;row++){
  const dx=half*.5,y=1.054+row*.0307,y1=y+.029;
  const equipmentType=await read([dx+.08,dx+.175,y,y1],'type'),equipmentNo=await read([dx+.185,dx+.34,y,y1],'number'),count=await read([dx+.35,dx+.49,y,y1],'count');
  if([equipmentType,equipmentNo,count].some(c=>c.present))summary.push({rowNumber:half*4+row+1,equipmentType,equipmentNo,count});
 }
 return {template:'standard-trip-card-v1',rows,summary};
}
export function resolveTripGrid(grid,shift){
 const trips=[],scanMachineSummary=[],issues=[],hasTime=grid.rows.some(r=>r.loading.present||r.unloading.present);let last=null;
 for(const row of grid.rows){
  let type=row.equipmentType.value,no=row.equipmentNo.value;
  if(!row.equipmentType.present&&!row.equipmentNo.present&&last){type=last.type;no=last.no;}
  else if(!row.equipmentType.present&&row.equipmentNo.value===last?.no)type=last.type;
  const equipmentName=row.equipmentName||(type&&no?type+no:!row.equipmentType.present&&!row.equipmentNo.present?last?.equipmentName||'':'');last={type,no,equipmentName};
  if(!equipmentName)issues.push('Trip '+row.rowNumber+': equipment type/number needs checking.');
  if(hasTime&&(!row.loading.value||!row.unloading.value))issues.push('Trip '+row.rowNumber+': loading/unloading time needs checking.');
  trips.push({rowNumber:row.rowNumber,equipmentName,loadingTime:tripClockForShift(row.loading.value,shift),unloadingTime:tripClockForShift(row.unloading.value,shift),tripCount:1});
 }
 for(const row of grid.summary){const type=row.equipmentType.value,no=row.equipmentNo.value;let name=row.equipmentName||(type&&no?type+no:'');
  if(!type&&no){const names=[...new Set(trips.filter(t=>t.equipmentName.match(/\d+$/)?.[0]===no).map(t=>t.equipmentName))];if(names.length===1)name=names[0];}
  if(!name||!row.count.value)issues.push('Machine summary '+row.rowNumber+': equipment/count needs checking.');
  scanMachineSummary.push({equipmentName:name,tripCount:row.count.value?Number(row.count.value):0});
 }
 return {trips,scanMachineSummary,issues,timeMode:grid.rows.some(r=>r.loading.present||r.unloading.present)?'with':'without'};
}
