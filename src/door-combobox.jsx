import React,{useEffect,useId,useRef,useState} from 'react';
import {ChevronDown} from 'lucide-react';
import {doorLabel,searchSiteDoors} from './door-search.mjs';
import {exactTypedOption} from '../shared/typed-option-selection.mjs';
import {assetForSiteOnDate} from '../shared/equipment-transfer-history.mjs';
import './equipment-combobox.css';
export default function DoorCombobox({records=[],kind,location,bookDate,value,onSelect,disabled=false,loading=false,onUnmatched=null}){
 const id=useId(),input=useRef(null),list=useRef(null),[query,setQuery]=useState(null),[open,setOpen]=useState(false),[active,setActive]=useState(-1);
 const label=row=>doorLabel(row,kind);
 const effective=bookDate?records.map(row=>assetForSiteOnDate(row,location,bookDate)):records;
 const atSite=searchSiteDoors(effective,kind,location),selected=atSite.find(r=>String(r.id)===String(value)),options=searchSiteDoors(effective,kind,location,query||''),expanded=open&&!disabled&&Boolean(location),activeRow=options[active];
 useEffect(()=>{input.current?.setCustomValidity(selected?'':'Select a door number from the matching list for this location.');},[selected,query]);
 useEffect(()=>{if(value)setQuery(null);},[value]);
 useEffect(()=>{list.current?.querySelector('[data-active="true"]')?.scrollIntoView({block:'nearest'});},[active]);
 const choose=row=>{onSelect(String(row.id));input.current?.focus();setQuery(null);setOpen(false);setActive(-1);};
 const keyDown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setOpen(true);setActive(n=>!options.length?-1:e.key==='ArrowDown'?Math.min(n+1,options.length-1):n<0?options.length-1:Math.max(n-1,0));}else if(e.key==='Enter'&&expanded){const row=activeRow||exactTypedOption(query,options,label)||(options.length===1?options[0]:null);if(row){e.preventDefault();if(e.currentTarget)e.currentTarget.dataset.enterCommitted='true';choose(row)}}else if(e.key==='Escape'){e.preventDefault();setOpen(false);setActive(-1);}};
 return <div className="equipment-combobox door-combobox" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget)){setOpen(false);setActive(-1);}}}>
  <div className="equipment-combobox-control"><input ref={input} required type="text" role="combobox" autoComplete="off" aria-label="Door number" aria-autocomplete="list" aria-expanded={expanded} aria-controls={id+'-list'} aria-activedescendant={expanded&&activeRow?id+'-'+active:undefined} disabled={disabled||!location||loading} value={query??(selected?label(selected):'')} placeholder={!location?'Select location first':loading?'Loading doors…':kind==='lmv'?'Type a door or registration number…':'Type S, V or a door number…'} onFocus={()=>setOpen(true)} onClick={()=>setOpen(true)} onKeyDown={keyDown} onChange={e=>{setQuery(e.target.value);setOpen(true);setActive(-1);onSelect('');}}/><ChevronDown aria-hidden="true"/></div>
  {expanded&&<div className="equipment-combobox-menu"><div className="equipment-combobox-count" role="status">{options.length} matching {kind==='lmv'?'vehicles':'doors'} · {location}{onUnmatched&&!options.length&&query&&/d/.test(query)&&<button type="button" className="equipment-combobox-map" onPointerDown={e=>e.preventDefault()} onClick={()=>onUnmatched(query)}>Written on the card as {query}? Map it to a Pulse record</button>}</div><ul ref={list} id={id+'-list'} role="listbox" aria-label="Door numbers at selected location">{options.map((r,i)=><li key={r.id} id={id+'-'+i} role="option" tabIndex={-1} aria-selected={String(r.id)===String(value)} data-active={active===i} onPointerDown={e=>{if(e.pointerType==='mouse')e.preventDefault();}} onClick={e=>{e.preventDefault();e.stopPropagation();choose(r);}}><strong>{label(r)}</strong></li>)}</ul>{!options.length&&<p className="equipment-combobox-empty">No {kind==='lmv'?'vehicles matching':'doors starting with'} “{query||''}” at {location}.</p>}</div>}
 </div>;
}
