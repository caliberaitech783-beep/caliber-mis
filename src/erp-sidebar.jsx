import {isMisAdministrator} from '../shared/mis-admin-access.mjs';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import './erp-layout.css';
import './erp-sidebar.css';
import {ChevronDown, ChevronRight, LayoutDashboard, Search, PanelLeftClose, LogOut, FileText, X, CornerDownLeft} from 'lucide-react';
import {highlightRanges, prepareMenuEntry, searchMenu} from './erp-menu-search.mjs';

const labelOf=item=>typeof item==='string'?item:item.label;
const targetOf=item=>typeof item==='string'?item:{page:item.page,reportCategory:item.reportCategory};

// Every page the menu can open, flattened with the menu path that leads to it.
export function menuEntries(groups){
  const entries=[{label:'Dashboard',path:[],target:'Dashboard',group:''},{label:'Fleet reconciliation',path:[],target:'Fleet reconciliation',group:''}];
  const walk=(items,path,group)=>items.forEach(item=>{
    if(item.children)return walk(item.children,[...path,labelOf(item)],group);
    entries.push({label:labelOf(item),path,target:targetOf(item),group,item});
  });
  groups.forEach(group=>walk(group.pages,group.direct?[]:[group.name],group.direct?'':group.name));
  return entries.map((entry,index)=>prepareMenuEntry({...entry,id:`erp-menu-result-${index}`}));
}

function Highlight({text,query}){
  const ranges=highlightRanges(text,query);
  if(!ranges.length)return text;
  const parts=[];let at=0;
  ranges.forEach(([from,to],index)=>{if(from>at)parts.push(text.slice(at,from));parts.push(<mark key={index}>{text.slice(from,to)}</mark>);at=to;});
  if(at<text.length)parts.push(text.slice(at));
  return parts;
}

export default function ErpSidebar({active,setActive,logout,open,hidden=false,onHide,autoHide=false,onAutoHide,onPointerInside,session,groups=[],activeReportCategory='general',announcements=null}) {
  const [expanded,setExpanded]=useState('MIS');
  const [query,setQuery]=useState('');
  const [cursor,setCursor]=useState(0);
  const asideRef=useRef(null),searchRef=useRef(null),listRef=useRef(null);
  const select=page=>setActive(page);
  const entries=useMemo(()=>menuEntries(groups),[groups]);
  const results=useMemo(()=>query.trim()?searchMenu(query,entries):[],[query,entries]);
  const showAnnouncements=Boolean(announcements)&&(!query.trim()||searchMenu(query,[{label:'Announcements',path:[]}]).length>0);
  const isSelected=item=>{
    if(typeof item==='string')return active===item;
    return (active===item.page||item.activePages?.includes(active))&&(!item.reportCategory||activeReportCategory===item.reportCategory);
  };
  const containsActive=item=>item.children?item.children.some(containsActive):isSelected(item);

  useEffect(()=>setCursor(0),[query]);
  useEffect(()=>{listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({block:'nearest'});},[cursor]);
  // Ctrl+K (or / outside a text box) jumps to the menu search from anywhere, opening the menu if needed.
  useEffect(()=>{
    const onKey=event=>{
      const typing=event.target?.closest?.('input,textarea,select,[contenteditable="true"]');
      const shortcut=((event.ctrlKey||event.metaKey)&&!event.altKey&&event.key?.toLowerCase()==='k')||(!typing&&event.key==='/'&&!event.ctrlKey&&!event.metaKey&&!event.altKey);
      if(!shortcut)return;
      event.preventDefault();
      if(hidden){if(autoHide)onPointerInside?.(true);else document.getElementById('erp-sidebar-toggle')?.click();}
      requestAnimationFrame(()=>requestAnimationFrame(()=>{searchRef.current?.focus();searchRef.current?.select();}));
    };
    window.addEventListener('keydown',onKey);
    return ()=>window.removeEventListener('keydown',onKey);
  },[hidden,autoHide,onPointerInside]);

  const openResult=entry=>{
    if(!entry)return;
    if(entry.group)setExpanded(entry.group);
    setQuery('');
    select(entry.target);
  };
  const onSearchKey=event=>{
    if(event.key==='ArrowDown'&&results.length){event.preventDefault();setCursor(at=>(at+1)%results.length);}
    else if(event.key==='ArrowUp'&&results.length){event.preventDefault();setCursor(at=>(at-1+results.length)%results.length);}
    else if(event.key==='Enter'&&results.length){event.preventDefault();openResult(results[cursor]);}
    else if(event.key==='Escape'){event.preventDefault();if(query)setQuery('');else event.currentTarget.blur();}
  };
  const onSearchBlur=()=>{if(autoHide&&!asideRef.current?.matches(':hover'))requestAnimationFrame(()=>onPointerInside?.(false));};

  const renderPage=item=>{
    const name=labelOf(item);
    if(item.children)return <details className="erp-nested-menu" key={name} open={containsActive(item)?true:undefined}><summary><span>{name}</span><ChevronDown size={14}/></summary><div className="erp-submenus erp-nested-pages">{item.children.map(renderPage)}</div></details>;
    const selected=isSelected(item);
    return <button key={name} className={`erp-page${selected?' selected':''}`} aria-current={selected?'page':undefined} onClick={()=>select(targetOf(item))}><FileText size={15}/><span>{name}</span></button>;
  };

  return <aside ref={asideRef} id="admin-primary-navigation" hidden={hidden} inert={hidden||undefined} className={`erp-sidebar pinned${open?' open':''}`} aria-label="Primary navigation" onMouseEnter={()=>onPointerInside?.(true)} onMouseLeave={()=>onPointerInside?.(false)}>
    <a className="erp-sidebar-brand" href="#" onClick={e=>{e.preventDefault();select('Dashboard')}}><span className="erp-brand-icon"><img src="/pulse-ii-icon.png" alt="Caliber Pulse-II"/></span><span className="erp-brand-copy"><strong>Caliber Pulse-II</strong></span></a>
    <div className="erp-sidebar-controls">
      <button type="button" className="erp-pin" aria-label="Hide sidebar" onClick={onHide}><PanelLeftClose size={15}/>Hide sidebar</button>
      {onAutoHide&&<button type="button" className="erp-pin erp-autohide" aria-pressed={autoHide} title="When on, the menu stays out of the way and opens when the pointer touches the left edge of the screen." onClick={onAutoHide}><span className="erp-switch" aria-hidden="true"/>Auto-hide {autoHide?'On':'Off'}</button>}
    </div>
    <div className="erp-menu-search-wrap">
      <label className="erp-menu-search"><Search size={15}/><input ref={searchRef} aria-label="Search menu" role="combobox" aria-expanded={Boolean(query.trim())} aria-controls="erp-menu-results" aria-activedescendant={results[cursor]?.id} autoComplete="off" spellCheck={false} placeholder="Smart search…" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={onSearchKey} onBlur={onSearchBlur}/>
        {query?<button type="button" className="erp-search-clear" aria-label="Clear search" onMouseDown={e=>e.preventDefault()} onClick={()=>{setQuery('');searchRef.current?.focus();}}><X size={14}/></button>:<kbd title="Press Ctrl+K or / from anywhere">Ctrl K</kbd>}
      </label>
    </div>
    <nav aria-label="ERP modules">
      {query.trim()?<div className="erp-search-results">
        <p className="erp-search-count" aria-live="polite">{results.length?`${results.length} ${results.length===1?'page':'pages'}${results[0]?.loose?' · closest spelling':''}`:`No page matches “${query.trim()}”`}</p>
        {results.length>0&&<div id="erp-menu-results" role="listbox" aria-label="Matching pages" ref={listRef}>
          {results.map((entry,index)=><button type="button" role="option" id={entry.id} key={entry.id} aria-selected={index===cursor} className={`erp-search-result${index===cursor?' active':''}`} onMouseEnter={()=>setCursor(index)} onMouseDown={e=>e.preventDefault()} onClick={()=>openResult(entry)}>
            <span className="erp-search-result-label"><Highlight text={entry.label} query={query}/></span>
            {entry.path.length>0&&<small className="erp-search-result-path">{entry.path.join(' › ')}</small>}
            {index===cursor&&<CornerDownLeft size={13} className="erp-search-enter" aria-hidden="true"/>}
          </button>)}
        </div>}
        {!results.length&&<p className="erp-search-hint">Try a short form like VLB, ELB, LMV, OT or BD, or a few letters of the page name.</p>}
        {showAnnouncements&&announcements}
      </div>:<>
        <button className={`erp-page${active==='Dashboard'?' selected':''}`} aria-current={active==='Dashboard'?'page':undefined} onClick={()=>select('Dashboard')}><LayoutDashboard size={15}/><span>Dashboard</span></button>
        <button className={`erp-page${active==='Fleet reconciliation'?' selected':''}`} aria-current={active==='Fleet reconciliation'?'page':undefined} onClick={()=>select('Fleet reconciliation')}><FileText size={15}/><span>Fleet reconciliation</span></button>
        {groups.map(group=>{
          if(group.direct)return group.pages.map(renderPage);
          const isOpen=expanded===group.name;
          const id=`erp-group-${group.name.replaceAll(' ','-')}`;
          const holdsActive=group.pages.some(containsActive);
          return <div className={`erp-nav-group${isOpen?' open':''}`} key={group.name}><button className={`erp-group-toggle${holdsActive?' holds-active':''}`} aria-expanded={isOpen} aria-controls={id} onClick={()=>setExpanded(isOpen?'':group.name)}><span>{group.name}</span>{isOpen?<ChevronDown size={15}/>:<ChevronRight size={15}/>}</button>
            {isOpen&&<div id={id} className="erp-submenus">{group.pages.map(renderPage)}</div>}
          </div>;
        })}
        {announcements}
      </>}
    </nav>
    <footer><strong>{session?.name}</strong><small>{session?.permissions?.separateMisCredentials?(isMisAdministrator(session)?'MIS Admin':'MIS User'):session?.permissions?.adminLevel||'ERP workspace'}</small><button onClick={logout}><LogOut size={15}/>Sign out</button></footer>
  </aside>;
}
