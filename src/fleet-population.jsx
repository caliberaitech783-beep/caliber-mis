import React,{useEffect,useState} from 'react';
import './production-reports.css';
import {EquipmentPulseMatch} from './equipment-pulse-mismatch.jsx';

const fields=[['make','Make'],['model','Model'],['bucketCapacity','Bucket Capacity'],['dailyCapacity','Daily Capacity (cu.m)']];
const columns=fields.map(([key,label])=>({key,label,value:row=>row[key],...(key.endsWith('Capacity')?{render:row=>row[key]??''}:{})}));
const blank={make:'',model:'',bucketCapacity:'',dailyCapacity:''};
const capacityPath='/api/capacity-master/fleet';
const reportPath='/api/reports/fleet-population';

async function request(path,token,{signal,record}={}){
 const response=await fetch(path,{signal,method:record?'PUT':'GET',
  headers:{Authorization:'Bearer '+token,...(record?{'Content-Type':'application/json'}:{})},
  body:record?JSON.stringify(record):undefined});
 const data=await response.json();
 if(!response.ok)throw Error(data.error||'Could not load fleet data.');
 return data;
}

function useFleetData(path,token){
 const [data,setData]=useState(null),[error,setError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  setData(null);setError('');
  request(path,token,{signal:controller.signal}).then(setData).catch(e=>{if(!controller.signal.aborted)setError(e.message)});
  return ()=>controller.abort();
 },[path,token]);
 return {data,setData,error,setError};
}

export function FleetCapacityMaster({session,ReportSection}){
 const {data,setData,error,setError}=useFleetData(capacityPath,session.token);
 const [form,setForm]=useState(blank),[editing,setEditing]=useState(false),[saving,setSaving]=useState(false),[notice,setNotice]=useState('');
 const reset=()=>{setForm(blank);setEditing(false)};
 const save=async event=>{
  event.preventDefault();
  setSaving(true);setError('');setNotice('');
  try{
   const record={...form,bucketCapacity:Number(form.bucketCapacity),dailyCapacity:Number(form.dailyCapacity)};
   setData(await request(capacityPath,session.token,{record}));
   setNotice('Saved '+form.make+' '+form.model+'.');reset();
  }catch(e){setError(e.message)}finally{setSaving(false)}
 };
 return <>
  <p>Manage bucket and daily capacities by make and model for the Fleet Capacity report.</p>
  <form className="production-filters" onSubmit={save}>
   {fields.map(([key,label],i)=><label key={key}>{label}<input required
    type={i<2?'text':'number'} maxLength={i<2?100:undefined} min={i<2?undefined:0} step={i<2?undefined:0.001}
    readOnly={editing&&i<2} value={form[key]} onChange={event=>setForm({...form,[key]:event.target.value})}/></label>)}
   <button type="submit" disabled={!data||saving}>Save capacity</button>
   {editing&&<button type="button" disabled={saving} onClick={reset}>Cancel</button>}
  </form>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {data&&<ReportSection title="Fleet capacity by model" category="fleet-capacity-master" rows={data.rows}
   columns={columns} rowAction={row=><button type="button" disabled={saving}
    onClick={()=>{setForm(row);setEditing(true);setNotice('')}}>Edit</button>} rowKey={row=>JSON.stringify([row.make,row.model])}/>}
 </>;
}

export function FleetPopulationReport({session,ReportSection,capacity}){
 const {data,error}=useFleetData(reportPath,session.token);
 const title=capacity?'Fleet Capacity':'Equipment Deployment';
 if(!data)return <p role={error?'alert':'status'}>{error||'Loading '+title+'…'}</p>;
 const rows=capacity?data.capacity:data.deployment;
 const base=capacity?columns:[{key:'equipment',label:'Equipment',value:row=>row.equipment}];
 const population=(row,key)=>key===null?data.sites.reduce((sum,site)=>sum+(row.population[site.key]||0),0):row.population[key]||0;
 const total={make:'Total',equipment:'Total',population:Object.fromEntries(data.sites.map(({key})=>[key,rows.reduce((sum,row)=>sum+population(row,key),0)]))};
 const totals=new Map(capacity?data.sites.map(({key})=>[key,rows.reduce((sum,row)=>sum+population(row,key)*row.dailyCapacity,0)]):[]);
 const groups=[...data.sites,{key:null,label:capacity?'Total Caliber':'Total'}];
 const reportColumns=[...base,...groups.flatMap(({key,label})=>{
  const count={key:JSON.stringify([key,'population']),label:capacity?label+' · Population':label,...(capacity?{headerGroup:label,headerLabel:'Population'}:{}),value:row=>population(row,key)};
  if(!capacity)return [{...count,render:count.value}];
  const volume={key:JSON.stringify([key,'capacity']),label:label+' · Capacity (cu.m)',headerGroup:label,headerLabel:'Capacity (cu.m)',value:row=>{
   const result=row===total?(key===null?[...totals.values()].reduce((sum,n)=>sum+n,0):totals.get(key)):population(row,key)*row.dailyCapacity;
   return Math.round(result*1000)/1000;
  }};
  return [{...count,render:count.value},{...volume,render:volume.value}];
 })];
 return <section className="production-reports">
  <ReportSection title={title} category={capacity?'fleet-capacity':'equipment-deployment'}
   description={capacity?'Current fleet by make and model. Site capacity is population multiplied by daily capacity.':'Current equipment population by equipment group and location.'}
   columns={reportColumns} rowClassName={row=>row===total?'fleet-population-total':undefined} rows={[...rows,total]} rowKey={row=>JSON.stringify(capacity?[row.make,row.model]:[row.equipment])}/>
  {!capacity&&<EquipmentPulseMatch session={session}/>}
 </section>;
}
