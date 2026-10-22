export const blankTrip=()=>({equipmentName:'',loadingTime:'',unloadingTime:'',tripCount:1});
export function nextTripEntry(trips,index,timeMode='with',limit=300){
 const row=trips[index],time=v=>/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(v||'');
 if(!row||!String(row.equipmentName||'').trim()||!Number.isSafeInteger(Number(row.tripCount))||Number(row.tripCount)<1||timeMode!=='without'&&(!time(row.loadingTime)||!time(row.unloadingTime)))return {error:'Complete the equipment, times and positive trip count before continuing.'};
 if(index<trips.length-1)return {trips,nextIndex:index+1};
 if(trips.length>=limit)return {error:'The trip-row limit has been reached.'};
 return {trips:[...trips,blankTrip()],nextIndex:trips.length};
}
