import {canonicalSiteName} from './site-location.mjs';
import {parseRequestTimelineTimestamp} from './request-timeline.mjs';
import {validTripCardImageDataUrl} from './request-workflow.mjs';
import {scanImageMime} from './scan-image-format.mjs';
import {filterLogBookSites,requireLogBookSite} from './log-book-access.mjs';

export const TRIP_VERIFICATION_SCHEMA=`CREATE TABLE IF NOT EXISTS mis_pulse_trip_verifications(
 logbook_id BIGINT PRIMARY KEY REFERENCES mis_log_books(id),status TEXT NOT NULL DEFAULT 'pending'
 CHECK(status IN ('pending','review','verified')),reason TEXT NOT NULL DEFAULT 'Waiting for Pulse',
 request_ref TEXT NOT NULL DEFAULT '',first_trip_at TIMESTAMPTZ,verified_at TIMESTAMPTZ,
 attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE INDEX IF NOT EXISTS mis_pulse_trip_verifications_pending ON mis_pulse_trip_verifications(next_attempt_at) WHERE status='pending';`;

const key=value=>String(value||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
const epoch=value=>parseRequestTimelineTimestamp(value)?.getTime()??NaN;
const review=reason=>({status:'review',reason});
const pending=reason=>({status:'pending',reason});
export const tripVerificationMarker=record=>`Pulse II automatic MIS verification | ${record.book_no} | card ${record.data.scanCardId}`;

// A chassis conflict must never fall back to a reused door number.
export function sameTripVehicle(data,request){
 const chassis=key(data.chassis),otherChassis=key(request.chassis);
 if(chassis&&otherChassis)return chassis===otherChassis;
 const door=key(data.door),registration=key(data.registration);
 const otherDoor=key(request.door),otherRegistration=key(request.reg||request.registration);
 if(door&&otherDoor&&door!==otherDoor||registration&&otherRegistration&&registration!==otherRegistration)return false;
 return Boolean(door&&door===otherDoor||registration&&registration===otherRegistration);
}

export function planTripVerification(record,requests,{now=Date.now()}={}){
 const data=record.data||{},marker=tripVerificationMarker(record);
 if(record.book_type!=='vehicle'||!data.scanCardId)return review('A saved vehicle trip card with its original scan is required.');
 const matched=requests.filter(r=>!r.archivedAt&&canonicalSiteName(r.site)===canonicalSiteName(data.location)&&sameTripVehicle(data,r));
 const recovered=matched.filter(r=>r.verifiedAt&&r.firstTripRemark===marker);
 if(recovered.length===1)return {status:'verified',reason:'Verified in Pulse',request:recovered[0],firstTripAt:recovered[0].firstTripAt};
 const closed=matched.filter(r=>!r.verifiedAt&&String(r.verificationStatus).toLowerCase()!=='verified'&&r.status==='Closed'&&r.vehicleIdle!==true);
 if(!closed.length)return pending('Waiting for a closed, unverified Pulse breakdown for this vehicle and site.');
 if(data.timeMode!=='with'||!data.trips?.length)return review('Trip times are missing. Check the card and enter loading and unloading times.');
 const start=epoch(`${data.bookDate}T${data.masterShiftStart}`),hours=Number(data.shiftHours),end=start+hours*3600000;
 if(!Number.isFinite(start)||![8,12].includes(hours))return review('The card date or Shift Master start time is missing or invalid.');
 const clock=value=>{const m=String(value||'').match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);return m&&Number(m[1])<24&&Number(m[2])<60&&Number(m[3]||0)<60?Number(m[1])*3600+Number(m[2])*60+Number(m[3]||0):NaN;};
 const shiftClock=clock(data.masterShiftStart);
 const tripTime=value=>start+((clock(value)-shiftClock+86400)%86400)*1000;
 const trips=[];
 for(const row of data.trips){
  const loading=tripTime(row.loadingTime),unloading=tripTime(row.unloadingTime);
  if(Number(row.tripCount)!==1||!Number.isFinite(loading)||!Number.isFinite(unloading)||loading<start||loading>=end||unloading<loading||unloading>end)return review('Each trip needs one loading time and one later unloading time within the selected shift. Check incomplete or grouped trip rows.');
  if(unloading>now)return review('A trip ends in the future. Check the card date, shift and times.');
  trips.push({loading,unloading});
 }
 trips.sort((a,b)=>a.loading-b.loading);
 // Multiple old closures cannot be resolved safely with one card.
 const candidates=closed.filter(r=>{const at=epoch(r.closedAt);return Number.isFinite(at)&&at<end&&at>=start-24*3600000;});
 if(candidates.length>1)return review('More than one Pulse breakdown could match this card. MIS must choose the correct request.');
 if(!candidates.length)return review('No recent maintenance closure matches this card shift. MIS must check the request dates.');
 const request=candidates[0],closedAt=epoch(request.closedAt),startedAt=epoch(request.start);
 if(!request.ref||!Number.isFinite(startedAt)||startedAt>closedAt)return review('The matching Pulse request has an invalid reference or breakdown timeline.');
 const first=trips.find(t=>t.loading>=closedAt);
 if(!first)return review('This card has no completed trip starting after maintenance closure.');
 if(matched.some(r=>r.ref!==request.ref&&epoch(r.start)>closedAt&&epoch(r.start)<=first.unloading))return review('Another breakdown occurred before this trip finished. MIS must check the correct request.');
 if(request.firstTripAt&&epoch(request.firstTripAt)!==first.loading)return review('Pulse already has a different MIS first-trip time. MIS must review it.');
 if(request.productionFirstTripAt&&epoch(request.productionFirstTripAt)!==first.loading)return review('Production confirmed a different first-trip time in Pulse. MIS must review the difference.');
 const readings={HMR:String(data.closingHmr??''),KMR:String(data.closingKmr??'')};
 for(const meter of ['HMR','KMR']){
  const close=Number(readings[meter]),open=Number(data[meter==='HMR'?'openingHmr':'openingKmr']);
  const source=request.openingMeterReadings?.[meter]??(request.meterType===meter?request.openingMeterReading:null);
  if(!readings[meter]||!Number.isFinite(close)||close<0||!Number.isFinite(open)||close<open||source!=null&&source!==''&&close<Number(source))return review('Trip-card meter readings conflict with the card or Pulse opening readings.');
 }
 if(!['HMR','KMR'].includes(request.meterType))return review('The Pulse request has no valid HMR/KMR meter type.');
 const local=new Date(first.loading+330*60000).toISOString();
 return {status:'ready',request,firstTripAt:new Date(first.loading).toISOString(),payload:{firstTripDone:true,firstTripDate:local.slice(0,10),firstTripTime:local.slice(11,19),closingMeterReadings:readings,closingMeterReading:readings[request.meterType],firstTripRemark:marker}};
}

export async function enqueueTripVerification(client,record){
 if(record.book_type!=='vehicle'||!record.data?.scanCardId)return;
 await client.query(`INSERT INTO mis_pulse_trip_verifications(logbook_id) VALUES($1)
 ON CONFLICT(logbook_id) DO UPDATE SET status=CASE WHEN mis_pulse_trip_verifications.status='verified' THEN 'verified' ELSE 'pending' END,
 reason=CASE WHEN mis_pulse_trip_verifications.status='verified' THEN 'Card edited after verification; check any correction in Pulse manually.' ELSE 'Saved card updated; waiting for Pulse' END,
 next_attempt_at=NOW(),updated_at=NOW()`,[record.id]);
}

export function createTripVerification({pool,pulse,enabled=true}){
 let timer,busy=false,lastError='',lastRun=null;
 async function run(){
  if(busy||!enabled||!pulse.status().connected)return;
  busy=true;
  try{
   for(let count=0;count<20;count++){
    const client=await pool.connect();
    try{
     await client.query('BEGIN');
     // Lock both the job and card: editing/deleting the saved card waits for this decision.
     const row=(await client.query(`SELECT j.*,l.id,l.book_no,l.book_type,l.data,l.created_by FROM mis_pulse_trip_verifications j
      JOIN mis_log_books l ON l.id=j.logbook_id WHERE j.status='pending' AND j.next_attempt_at<=NOW() AND l.deleted_at IS NULL
      ORDER BY j.next_attempt_at,j.logbook_id LIMIT 1 FOR UPDATE OF j,l SKIP LOCKED`)).rows[0];
     if(!row){await client.query('COMMIT');break;}
     let result;
     try{
      const card=(await client.query("SELECT image,status,logbook_id FROM mis_scan_cards WHERE id=$1",[row.data.scanCardId])).rows[0];
      if(!card||card.status!=='posted'||String(card.logbook_id)!==String(row.id))result=review('The original posted scan is unavailable. MIS must check the saved card.');
      else{
       const requests=await pulse.readBreakdownRequests({fresh:true});
       result=planTripVerification(row,requests);
       if(result.status==='ready'){
        const image=`data:${scanImageMime(card.image)};base64,${Buffer.from(card.image).toString('base64')}`;
        if(!validTripCardImageDataUrl(image))result=review('The source image exceeds the Pulse image limit. MIS must upload a smaller copy.');
        else{
         const verified=await pulse.verifyTripCard(result.request.ref,{...result.payload,firstTripCardImage:image});
         if(!verified.verifiedAt||verified.firstTripRemark!==result.payload.firstTripRemark||epoch(verified.firstTripAt)!==epoch(result.firstTripAt))throw Object.assign(new Error('Pulse did not confirm this trip-card verification. Check the request in Pulse.'),{status:409});
         result={...result,status:'verified',reason:'Verified in Pulse',verifiedAt:verified.verifiedAt};
        }
       }
      }
     }catch(error){result=error.status&&[400,403,404,409,413].includes(error.status)?review(error.message):pending(error.message||'Pulse is unavailable; automatic retry pending.');}
     // Do not poll indefinitely for an unrelated or never-closed request.
     if(result.status==='pending'&&Date.now()-new Date(row.created_at).getTime()>7*86400000)result=review('No verification completed within seven days. '+result.reason);
     await client.query(`UPDATE mis_pulse_trip_verifications SET status=$2,reason=$3,request_ref=$4,first_trip_at=$5,
      verified_at=$6,attempts=attempts+1,next_attempt_at=NOW()+INTERVAL '1 minute',updated_at=NOW() WHERE logbook_id=$1`,
     [row.id,result.status,result.reason,result.request?.ref||'',result.firstTripAt||null,result.verifiedAt||result.request?.verifiedAt||null]);
     await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
   }
   lastError='';lastRun=new Date().toISOString();
  }catch(error){lastError=error.message;}finally{busy=false;}
 }
 return {run,status:()=>({enabled,connected:pulse.status().connected,busy,lastRun,error:lastError}),start(){if(timer)return;void run();timer=setInterval(()=>void run(),60000);timer.unref?.();},stop(){clearInterval(timer);timer=null;}};
}

export function registerTripVerification(app,{pool,pulse,requireSession,requireAdministrator,getSiteScope,enabled=true}){
 const service=createTripVerification({pool,pulse,enabled});
 app.get('/api/pulse-trip-verification',requireSession,requireAdministrator,async(req,res,next)=>{try{
  const id=String(req.query.logbookId||'');
  if(id&&!/^\d+$/.test(id))return res.status(400).json({error:'Invalid saved card.'});
  const sites=await filterLogBookSites(pool,await getSiteScope(req.session));
  const jobs=(await pool.query(`SELECT j.*,l.book_no,l.site,l.data->>'door' AS door,l.data->>'scanCardNumber' AS card_number
   FROM mis_pulse_trip_verifications j JOIN mis_log_books l ON l.id=j.logbook_id WHERE l.deleted_at IS NULL AND ($1::text[] IS NULL OR l.site=ANY($1::text[])) AND ($2::bigint IS NULL OR l.id=$2)
   ORDER BY j.updated_at DESC,j.logbook_id DESC LIMIT 100`,[sites,id||null])).rows;
  const counts=(await pool.query(`SELECT j.status,COUNT(*)::int AS count FROM mis_pulse_trip_verifications j JOIN mis_log_books l ON l.id=j.logbook_id
   WHERE l.deleted_at IS NULL AND ($1::text[] IS NULL OR l.site=ANY($1::text[])) GROUP BY j.status`,[sites])).rows;
  res.set('Cache-Control','no-store').json({...service.status(),jobs,counts:Object.fromEntries(counts.map(r=>[r.status,r.count]))});
 }catch(error){next(error)}});
 app.post('/api/pulse-trip-verification/:id/retry',requireSession,requireAdministrator,async(req,res,next)=>{try{
  if(!/^\d+$/.test(req.params.id))return res.status(400).json({error:'Invalid saved card.'});
  const client=await pool.connect();try{
   await client.query('BEGIN');
   const record=(await client.query('SELECT site FROM mis_log_books WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[req.params.id])).rows[0];
   if(!record){await client.query('ROLLBACK');return res.status(404).json({error:'Saved card unavailable.'});}
   requireLogBookSite(await getSiteScope(req.session),record.site);
   await client.query("UPDATE mis_pulse_trip_verifications SET status='pending',reason='MIS requested a recheck',next_attempt_at=NOW(),updated_at=NOW() WHERE logbook_id=$1 AND status<>'verified'",[req.params.id]);
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  res.json({queued:true});void service.run();
 }catch(error){if(error.status)return res.status(error.status).json({error:error.message});next(error)}});
 return service;
}
