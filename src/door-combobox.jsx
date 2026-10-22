import React,{useEffect,useId,useRef,useState} from 'react';
import {ChevronDown} from 'lucide-react';
import {doorLabel,searchSiteDoors} from './door-search.mjs';
import './equipment-combobox.css';
export default function DoorCombobox({records=[],kind,location,value,onSelect,disabled=false,loading=false}){
 const id=useId(),input=useRef(null),list=useRef(null),[query,setQuery]=useState(null),[open,setOpen]=useState(false),[active,setActive]=useState(-1);
 const atSite=searchSiteDoors(records,kind,location),selected=atSite.find(r=>String(r.id)===String(value)),options=searchSiteDoors(records,kind,location,query||''),expanded=open&&!disabled&&Boolean(location),activeRow=options[active];
 useEffect(()=>{input.current?.setCustomValidity(selected?'':'Select a door number from the matching list for this location.');},[selected,query]);
 useEffect(()=>{if(value)setQuery(null);},[value]);
 useEffect(()=>{list.current?.querySelector('[data-active="true"]')?.scrollIntoView({block:'nearest'});},[active]);
 const choose=row=>{onSelect(String(row.id));setQuery(null);setOpen(false);setActive(-1);input.current?.focus();};
 const keyDown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setOpen(true);setActive(n=>!options.length?-1:e.key==='ArrowDown'?Math.min(n+1,options.length-1):n<0?options.length-1:Math.max(n-1,0));}else if(e.key==='Enter'&&expanded){e.preventDefault();if(activeRow)choose(activeRow);else if(options.length===1)choose(options[0]);}else if(e.key==='Escape'){e.preventDefault();setOpen(false);setActive(-1);}};
 return <div className="equipment-combobox door-combobox" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget)){setOpen(false);setActive(-1);}}}>
  <div className="equipment-combobox-control"><input ref={input} required type="text" role="combobox" autoComplete="off" aria-label="Door number" aria-autocomplete="list" aria-expanded={expanded} aria-controls={id+'-list'} aria-activedescendant={expanded&&activeRow?id+'-'+active:undefined} disabled={disabled||!location||loading} value={query??(selected?doorLabel(selected):'')} placeholder={!location?'Select location first':loading?'Loading doors…':'Type S, V or a door number…'} onFocus={()=>setOpen(true)} onClick={()=>setOpen(true)} onKeyDown={keyDown} onChange={e=>{setQuery(e.target.value);setOpen(true);setActive(-1);onSelect('');}}/><ChevronDown aria-hidden="true"/></div>
  {expanded&&<div className="equipment-combobox-menu"><div className="equipment-combobox-count" role="status">{options.length} matching doors · {location}</div><ul ref={list} id={id+'-list'} role="listbox" aria-label="Door numbers at selected location">{options.map((r,i)=><li key={r.id} id={id+'-'+i} role="option" tabIndex={-1} aria-selected={String(r.id)===String(value)} data-active={active===i} onPointerDown={e=>{if(e.pointerType==='mouse')e.preventDefault();}} onClick={()=>choose(r)}><strong>{doorLabel(r)}</strong></li>)}</ul>{!options.length&&<p className="equipment-combobox-empty">No doors starting with “{query||''}” at {location}.</p>}</div>}
 </div>;
}
