import {operationalDate} from './operational-start.mjs';
import {canonicalSiteName} from './site-location.mjs';
import {isUnloadingOnlyTrip} from './trip-card-rules.mjs';
import {fleetDoorKey} from './scan-fleet-door.mjs';

export const validTripTime=value=>/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value||'');
export function validTripTimes(row){
 return Boolean(row.loadingTime||row.unloadingTime)&&['loadingTime','unloadingTime'].every(key=>!row[key]||validTripTime(row[key]));
}
export const vlbCountedTrips=(row,timeMode)=>timeMode==='without'||validTripTime(row.loadingTime)&&!isUnloadingOnlyTrip(row)?Number(row.tripCount)||0:0;
const keyFor=data=>JSON.stringify([canonicalSiteName(data.location),fleetDoorKey(data.door)]);
const seconds=value=>String(value).split(':').reduce((n,v,i)=>n+Number(v)*[3600,60,1][i],0);
function eventTime(data,time){
 let stamp=Date.parse(data.bookDate+'T00:00:00Z')+seconds(time)*1000;
 if(data.masterShiftStart&&seconds(time)<seconds(data.masterShiftStart))stamp+=86400000;
 return stamp;
}
const reference=(record,index)=>({logBookId:String(record.id),bookNo:record.book_no,row:index+1,driverId:record.data.employeeId,driverName:record.data.employeeName,date:record.data.bookDate,shiftId:record.data.shiftId});

// Rebuild from active source cards on every read. Corrections, deletion, late scans
// and uploads in reverse order therefore cannot leave stale or duplicate links.
export function linkVlbTripHandovers(records){
 const output=records.filter(r=>operationalDate(r.data?.bookDate)).map(record=>({...record,data:{...record.data,trips:(record.data.trips||[]).map(row=>({...row,handoverLinks:[]}))}}));
 const groups=new Map();
 for(const record of output){
  const data=record.data;data.openingTrips=0;data.endingTrips=0;data.completedTrips=0;
  for(const [index,row] of data.trips.entries()){
   const count=Number(row.tripCount)||0,loading=Boolean(row.loadingTime)&&!isUnloadingOnlyTrip(row),unloading=Boolean(row.unloadingTime);
   data.openingTrips+=loading?count:0;data.endingTrips+=unloading?count:0;
   row.completedTrips=vlbCountedTrips(row,data.timeMode);data.completedTrips+=row.completedTrips;
   if(data.timeMode==='without'||loading&&unloading){row.tripStatus='closed';continue;}
   row.tripStatus=loading?'open':'awaiting-loading';row.unmatchedTrips=count;
   if(!validTripTimes(row)||!data.door||!data.location)continue;
   const key=keyFor(data);if(!groups.has(key))groups.set(key,[]);
   groups.get(key).push({record,index,row,loading,time:eventTime(data,loading?row.loadingTime:row.unloadingTime),remaining:count});
  }
 }
 for(const events of groups.values()){
  events.sort((a,b)=>a.time-b.time||String(a.record.id).localeCompare(String(b.record.id),undefined,{numeric:true})||a.index-b.index);
  const open=[];
  for(const end of events){
   if(end.loading){open.push(end);continue;}
   while(end.remaining&&open.length){
    const start=open[0],count=Math.min(start.remaining,end.remaining);
    if(!count){open.shift();continue;}
    const tripId=String(start.record.id)+':'+(start.index+1);
    const durationMinutes=(end.time-start.time)/60000;
    start.row.handoverLinks.push({tripId,role:'loading',tripCount:count,loadingTime:start.row.loadingTime,unloadingTime:end.row.unloadingTime,durationMinutes,counterpart:reference(end.record,end.index)});
    end.row.handoverLinks.push({tripId,role:'unloading',tripCount:count,loadingTime:start.row.loadingTime,unloadingTime:end.row.unloadingTime,durationMinutes,counterpart:reference(start.record,start.index)});
    start.remaining-=count;end.remaining-=count;start.row.unmatchedTrips=start.remaining;end.row.unmatchedTrips=end.remaining;
    start.row.tripStatus=start.remaining?'partly-closed':'closed';end.row.tripStatus=end.remaining?'partly-closed':'closed';
    if(!start.remaining)open.shift();
   }
  }
 }
 for(const record of output)record.data.totalTrips=record.data.completedTrips;
 return output;
}

export async function withVlbTripHandovers(client,records,permittedSites=null){
 if(!records.length)return records;
 const partial=(await client.query(`SELECT id,book_no,book_type,data FROM mis_log_books
 WHERE book_type='vehicle' AND deleted_at IS NULL AND book_date>=$$2026-11-01$$ AND ($1::text[] IS NULL OR site=ANY($1::text[]))
 AND mis_vlb_has_handover_trip(data)`,[permittedSites])).rows;
 const all=new Map(partial.map(row=>[String(row.id),row]));for(const row of records)all.set(String(row.id),row);
 const linked=new Map(linkVlbTripHandovers([...all.values()]).map(row=>[String(row.id),row]));
 return records.map(row=>linked.get(String(row.id)));
}
