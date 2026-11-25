import React,{useMemo,useState} from 'react';
import {TRAINING_MAX_PEOPLE} from '../shared/vtc-training.mjs';
import './vtc-training.css';

// VTC Training for several people at once (owner, 25 Nov 2026: "bulk"). people: the employees of the chosen site;
// chosen: their ids. Search by name or Caliber ID, tick each person, or tick every person the search shows.
export default function VtcTrainingPeople({people,chosen,onChange,label}){
 const [search,setSearch]=useState('');
 const idOf=row=>String(row.id);
 const codeOf=row=>row.caliberId||row.employeeCode||'';
 const shown=useMemo(()=>{
  const words=search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return people.filter(row=>{const text=(row.name+' '+codeOf(row)).toLowerCase();return words.every(w=>text.includes(w));});
 },[people,search]);
 const picked=new Set(chosen);
 const toggle=id=>onChange(picked.has(id)?chosen.filter(x=>x!==id):[...chosen,id].slice(0,TRAINING_MAX_PEOPLE));
 const allShown=shown.length>0&&shown.every(row=>picked.has(idOf(row)));
 const tickShown=()=>onChange(allShown
  ?chosen.filter(id=>!shown.some(row=>idOf(row)===id))
  :[...new Set([...chosen,...shown.map(idOf)])].slice(0,TRAINING_MAX_PEOPLE));
 const byId=new Map(people.map(row=>[idOf(row),row]));
 return <div className="logbook-field wide vtc-people">
  <span>{label} · {chosen.length} selected (up to {TRAINING_MAX_PEOPLE})</span>
  {chosen.length>0&&<div className="vtc-people-chosen" aria-label="Selected people">{chosen.map(id=>{const row=byId.get(id);return <button type="button" key={id} className="vtc-chip" onClick={()=>toggle(id)} title="Remove">{row?row.name+' · '+codeOf(row):id} ✕</button>;})}</div>}
  <div className="vtc-people-tools">
   <input type="search" aria-label={'Search '+label} placeholder="Search name or Caliber ID" value={search} onChange={e=>setSearch(e.target.value)}/>
   <label className="vtc-people-all"><input type="checkbox" checked={allShown} disabled={!shown.length} onChange={tickShown}/> Select all shown ({shown.length})</label>
  </div>
  <div className="vtc-people-list" role="group" aria-label={label}>
   {shown.length?shown.map(row=>{const id=idOf(row);return <label key={id} className={'vtc-person'+(picked.has(id)?' is-picked':'')}>
    <input type="checkbox" checked={picked.has(id)} onChange={()=>toggle(id)}/> <b>{codeOf(row)}</b> {row.name}</label>;})
   :<p className="vtc-people-empty">{people.length?'No one matches the search.':'No employee of this site in Employee Master.'}</p>}
  </div>
 </div>;
}
