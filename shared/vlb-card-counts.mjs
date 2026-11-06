export function validVlbCardCounts(value,batchId){
 if(!value||String(value.batchId)!==String(batchId))return null;
 for(const key of ['entry_count','manual_count','scan_count'])if(!Number.isSafeInteger(value[key])||value[key]<0)return null;
 if(value.manual_count+value.scan_count!==value.entry_count)return null;
 return value;
}
