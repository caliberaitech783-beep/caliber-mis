import {isMisAdministrator} from '../mis-admin-access.mjs';
import React, {useState} from 'react';
import './erp-layout.css';
import {ChevronDown, ChevronRight, LayoutDashboard, Search, PanelLeftClose, LogOut, FileText} from 'lucide-react';

export default function ErpSidebar({active,setActive,logout,open,hidden=false,onHide,session,groups=[],activeReportCategory='general',announcements=null}) {
  const [expanded,setExpanded]=useState('MIS');
  const [query,setQuery]=useState('');
  const select=page=>setActive(page);
  const matches=name=>name.toLowerCase().includes(query.trim().toLowerCase());
  const label=item=>typeof item==='string'?item:item.label;
  const includesQuery=item=>matches(label(item))||Boolean(item.children?.some(includesQuery));
  const renderPage=item=>{
    const name=label(item);
    if(item.children)return <details className="erp-nested-menu" key={name} open={query?true:undefined}><summary>{name}<ChevronDown size={13}/></summary><div className="erp-submenus">{(matches(name)?item.children:item.children.filter(includesQuery)).map(renderPage)}</div></details>;
    const page=typeof item==='string'?item:item.page;
    const selected=(active===page||item.activePages?.includes(active))&&(!item.reportCategory||activeReportCategory===item.reportCategory);
    return <button key={name} className={`erp-page${selected?' selected':''}`} aria-current={selected?'page':undefined} onClick={()=>select(typeof item==='string'?item:{page,reportCategory:item.reportCategory})}><FileText size={14}/><span>{name}</span></button>;
  };
  return <aside id="admin-primary-navigation" hidden={hidden} inert={hidden||undefined} className={`erp-sidebar pinned${open?' open':''}`} aria-label="Primary navigation">
    <a className="erp-sidebar-brand" href="#" onClick={e=>{e.preventDefault();select('Dashboard')}}><span className="erp-brand-icon"><img src="/pulse-ii-icon.png" alt="Caliber Pulse-II"/></span><span className="erp-brand-copy"><strong>Caliber Pulse-II</strong><small>All Departments Linked In One Place</small></span></a>
    <button type="button" className="erp-pin" aria-label="Hide sidebar" onClick={onHide}><PanelLeftClose size={15}/>Hide sidebar</button>
    <label className="erp-menu-search"><Search size={14}/><input aria-label="Search menu" placeholder="Search pages…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <nav aria-label="ERP modules">
      {matches('Dashboard')&&<button className={`erp-page${active==='Dashboard'?' selected':''}`} onClick={()=>select('Dashboard')}><LayoutDashboard size={16}/>Dashboard</button>}
      {groups.map(group=>{
        const pages=group.pages.filter(includesQuery);if(query&&!matches(group.name)&&!pages.length)return null;
        const visible=matches(group.name)?group.pages:pages;
        if(group.direct)return visible.map(renderPage);
        const isOpen=Boolean(query)||expanded===group.name;
        return <div className="erp-nav-group" key={group.name}><button className="erp-group-toggle" aria-expanded={isOpen} aria-controls={`erp-group-${group.name.replaceAll(' ','-')}`} onClick={()=>setExpanded(isOpen?'':group.name)}><span>{group.name}</span>{isOpen?<ChevronDown size={15}/>:<ChevronRight size={15}/>}</button>
          {isOpen&&<div id={`erp-group-${group.name.replaceAll(' ','-')}`} className="erp-submenus">{visible.map(renderPage)}</div>}
        </div>;
      })}
      {matches('Announcements')&&announcements}
    </nav>
    <footer><strong>{session?.name}</strong><small>{session?.permissions?.separateMisCredentials?(isMisAdministrator(session)?'MIS Admin':'MIS User'):session?.permissions?.adminLevel||'ERP workspace'}</small><button onClick={logout}><LogOut size={15}/>Sign out</button></footer>
  </aside>;
}
