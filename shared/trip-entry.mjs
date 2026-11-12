import {validTripTimes} from './vlb-trip-handover.mjs';
import {tripEquipmentRequired} from './trip-card-rules.mjs';
export const TRIP_CARD_ROWS=24;
export const tripCardForRow=index=>index<TRIP_CARD_ROWS?0:1;
export const blankTrip=()=>({equipmentName:'',loadingTime:'',unloadingTime:'',tripCount:1});
export function nextTripEntry(trips,index,timeMode='with',limit=300){
 const row=trips[index];
 if(!row||tripEquipmentRequired(row,timeMode)&&!String(row.equipmentName||'').trim()||!Number.isSafeInteger(Number(row.tripCount))||Number(row.tripCount)<1||timeMode!=='without'&&!validTripTimes(row))return {error:'Complete the equipment, times and positive trip count before continuing.'};
 if(index<trips.length-1)return {trips,nextIndex:index+1};
 if(trips.length>=limit)return {error:'The trip-row limit has been reached.'};
 return {trips:[...trips,blankTrip()],nextIndex:trips.length};
}
