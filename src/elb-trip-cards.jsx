import React,{useEffect,useState} from 'react';
import {tripSerialNumber} from '../shared/log-book-labels.mjs';

const shown=value=>value==null||value===''?'—':value;

function TripCard({card,indices,token}){
 const data=card.data||{};
 const [scan,setScan]=useState(null),[error,setError]=useState('');
 useEffect(()=>{
  if(!data.scanCardId)return;
  const controller=new AbortController();
  let url;
  (async()=>{try{
   const response=await fetch('/api/log-books/vehicle/'+card.id+'/source-image',{signal:controller.signal,headers:{Authorization:'Bearer '+token}});
   if(!response.ok)throw Error('The original trip card scan is unavailable.');
   const blob=await response.blob();
   if(!controller.signal.aborted){url=URL.createObjectURL(blob);setScan(url);}
  }catch(e){if(!controller.signal.aborted)setError(e.message);}})();
  return()=>{controller.abort();if(url)URL.revokeObjectURL(url);};
 },[card.id,data.scanCardId,token]);
 const timed=data.timeMode!=='without';
 return <div><p>{[data.aFormNo&&'Trip card '+data.aFormNo,data.door,data.employeeName].filter(Boolean).join(' · ')}</p>
  <div className="logbook-table-wrap"><table className="logbook-table"><thead><tr><th>Trip row</th><th>Equipment</th>{timed&&<><th>Loading</th><th>Unloading</th></>}<th>Trips</th></tr></thead>
  <tbody>{indices.map(index=>{
   const trip=data.trips?.[index];if(!trip)return null;
   return <tr key={index}><td>{tripSerialNumber(trip,index)}</td><td>{shown(trip.equipmentName)}</td>{timed&&<><td>{shown(trip.loadingTime)}</td><td>{shown(trip.unloadingTime)}</td></>}<td>{shown(trip.tripCount)}</td></tr>;
  })}</tbody></table></div>
  {!data.scanCardId?<p>No original scan was saved for this trip card.</p>:error?<p role="alert">{error}</p>:scan?<><a href={scan} target="_blank" rel="noreferrer">Open full-size trip card scan</a><img className="saved-logbook-image" src={scan} alt={'Original trip card for '+card.book_no}/></>:<p role="status">Loading trip card scan…</p>}
 </div>;
}

export default function ElbTripCards({batch,equipment,token}){
 const [selected,setSelected]=useState('');
 const rows=batch.elbTripCardRows?.[String(equipment.asset_id||equipment.data?.assetId)]||{};
 const cards=(batch.records||[]).filter(card=>rows[card.id]?.length);
 return <section aria-label="Related VLB trip cards"><h3>Related VLB trip cards</h3>
  {cards.length?<ul>{cards.map(card=><li key={card.id}>
   <button type="button" aria-expanded={selected===card.id} onClick={()=>setSelected(selected===card.id?'':card.id)}>
    {[card.book_no,card.data?.door].filter(Boolean).join(' · ')}
   </button>
   {selected===card.id&&<TripCard key={card.id} card={card} indices={rows[card.id]} token={token}/>}
  </li>)}</ul>:<p>No VLB trip cards in this batch list this equipment as the loader.</p>}
 </section>;
}
