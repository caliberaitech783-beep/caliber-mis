import {validScannedTime,normalizeScannedTime} from './scan-clock.mjs';
import {identifyCardMachine} from './scan-machine-rules.mjs';

const empty=value=>value==null||String(value).trim()==='';
export function estimateMissingTripTimes(input={},raw={}){
 if(input.timeMode==='without'||!input.trips?.length)return input;
 return {...input,trips:(input.trips||[]).map((original,index)=>{
  const row={...original};
  for(const [missing,known,sign] of [['loadingTime','unloadingTime',-1],['unloadingTime','loadingTime',1]]){
   if(!empty(row[missing])||!validScannedTime(row[known]))continue;
   const number=row.rowNumber||index+1,cell=raw.tripGrid?.rows?.find(r=>r.rowNumber===number)?.[missing==='loadingTime'?'loading':'unloading'];
   const literal=(raw.gemini||raw.hybrid)?.trips?.r?.find(r=>r[0]===number);
   if(cell?.present&&!cell.value||literal?.[missing==='loadingTime'?2:3]===null)continue;
   const time=normalizeScannedTime(row[known]),[h,m]=time.split(':').map(Number),minutes=(h*60+m+sign*22+1440)%1440;
   const value=String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
   row[missing]=value;
   row.timeEstimates={...row.timeEstimates,[missing]:{value,minutes:22,anchorField:known,anchorValue:row[known],dayOffset:Math.floor((h*60+m+sign*22)/1440)}};
  }
  return row;
 })};
}

export function previousScanShift(input={}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(input.bookDate||''))return null;
 const previous={I:['III',-1],II:['I',0],III:['II',0],Day:['Night',-1],Night:['Day',0]}[input.cardShift];
 if(!previous)return null;
 const date=new Date(input.bookDate+'T00:00:00Z');if(!Number.isFinite(date.getTime()))return null;
 date.setUTCDate(date.getUTCDate()+previous[1]);
 return {bookDate:date.toISOString().slice(0,10),cardShift:previous[0]};
}

export function completePreviousShiftMachines(input={},records=[]){
 const previous=previousScanShift(input);if(!previous)return input;
 const sources=records.filter(r=>r.data?.bookDate===previous.bookDate&&r.data?.cardShift===previous.cardShift);
 // A shift can have multiple cards. Conflicting terminal machines require review.
 const candidates=sources.map(record=>({record,row:(record.data.trips||[]).filter(r=>r.loadingTime||r.unloadingTime).at(-1)})).filter(item=>item.row?.equipmentName&&!item.row.equipmentSource&&!item.row.equipmentProvenance);
 if(!candidates.length)return input;
 return {...input,trips:(input.trips||[]).map(row=>{
  const machine=identifyCardMachine(row.equipmentName,'equipment',{allowSuffix:true});
  if(!empty(row.equipmentName)&&(!machine||machine.hasNumber)||!row.loadingTime&&!row.unloadingTime)return row;
  const matching=candidates.filter(item=>{
   const source=identifyCardMachine(item.row.equipmentName,'equipment',{allowSuffix:true});
   return source?.hasNumber&&(!machine||source.code===machine.code);
  });
  const names=new Set(matching.map(item=>identifyCardMachine(item.row.equipmentName,'equipment',{allowSuffix:true}).key));
  if(names.size!==1)return row;
  const {record,row:source}=matching[0];
  return {...row,equipmentName:source.equipmentName,equipmentSource:'previous-shift',equipmentNotation:{original:row.equipmentName||'',resolved:source.equipmentName},equipmentProvenance:{value:source.equipmentName,bookNo:record.book_no||'',logBookId:String(record.id),date:previous.bookDate,shift:previous.cardShift}};
 })};
}

export async function fillScanTripEstimates(client,input={},raw={}){
 if(raw.responseRecoveryIssues?.length)return input;
 let next=estimateMissingTripTimes(input,raw);
 const needsMachine=(next.trips||[]).some(row=>(row.loadingTime||row.unloadingTime)&&(empty(row.equipmentName)||identifyCardMachine(row.equipmentName,'equipment',{allowSuffix:true})?.hasNumber===false));
 const previous=previousScanShift(next);
 if(!needsMachine||!previous||!next.assetId||!next.location)return next;
 const records=(await client.query(`SELECT id,book_no,data FROM mis_log_books WHERE book_type='vehicle' AND deleted_at IS NULL AND asset_id=$1 AND site=$2 AND book_date=$3 AND data->>'cardShift'=$4 ORDER BY id DESC`,[next.assetId,next.location,previous.bookDate,previous.cardShift])).rows;
 return completePreviousShiftMachines(next,records);
}

export function tripEstimateNote(row,key){
 const estimate=row.timeEstimates?.[key];
 if(estimate&&row[key]===estimate.value&&row[estimate.anchorField]===estimate.anchorValue)return 'Estimated · 22 minutes '+(key==='loadingTime'?'before unloading':'after loading')+'.';
 const source=row.equipmentProvenance;
 if(key==='equipmentName'&&source&&row.equipmentName===source.value)return 'Taken from previous shift · '+source.date+' · '+source.shift+(source.bookNo?' · '+source.bookNo:'')+'.';
 return '';
}
