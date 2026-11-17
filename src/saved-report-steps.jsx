import React,{useMemo,useState} from 'react';
import {StepBackButton} from './step-back.jsx';
import {DateShiftGrid,dateShiftGrid,dateShiftExport,dateLine} from './date-shift-grid.jsx';
import {EVERY,countLabel,stepItems,openedItems,stepLines,stepTable} from './saved-report-steps-model.mjs';

// The Operations reports that were one long table, drawn in the owner's steps (17 Nov 2026): Step 1 one line per site;
// Step 2 that site date by shift; Step 3 the date and shift opened, by equipment category; Step 4 the report's own
// table for the category opened. Each step stays on screen under the one before; the line that opened it is outlined.
const day=d=>/^\d{4}-\d{2}-\d{2}/.test(String(d))?d.slice(8,10)+'-'+d.slice(5,7)+'-'+d.slice(2,4):String(d||'');
const isTotal=r=>Boolean(r.total);

export default function SavedReportSteps({id,title,period,report,records,data,build,ReportSection,dataReady,recordDateFilter}){
 const [site,setSite]=useState(''),[slot,setSlot]=useState(null),[category,setCategory]=useState(null);
 const items=useMemo(()=>stepItems(id,{records,cards:data?.cards||[],report,assets:data?.assets||[]}),[id,records,data,report]);
 const label=countLabel(id),noun=label.toLowerCase();
 const sites=stepLines(items,'site');
 const siteItems=site?openedItems(items,{site}):[],siteLabel=site===EVERY?'All sites':siteItems[0]?.site||site;
 const manySites=site===EVERY;
 const slots=stepLines(siteItems,manySites?'slot-site':'slot');
 // Over All sites a box is one site's date and shift, so it opens that site only.
 const slotItems=slot?openedItems(slot.siteKey?openedItems(siteItems,{site:slot.siteKey}):siteItems,{slot:slot.key}):[];
 const categories=stepLines(slotItems,'category');
 const opened=category?openedItems(slotItems,{category:category.key}):[];
 const table=category?stepTable(id,report,opened,build):null;
 const level=!site?1:!slot?2:!category?3:4;

 const openSite=r=>{setSite(r.total?EVERY:r.key);setSlot(null);setCategory(null);};
 const openSlot=r=>{setSlot(r?{key:r.date+'|'+r.shift,siteKey:manySites?r.key.split('|')[2]:'',label:day(r.date)+' · '+r.shift+(manySites?' · '+r.site:'')}:{key:EVERY,label:'All dates and shifts'});setCategory(null);};
 const openCategory=r=>setCategory(r.total?{key:EVERY,label:'All categories'}:{key:r.key,label:r.category});
 const crumbs=[['All sites',()=>{setSite('');setSlot(null);setCategory(null);}],...(site?[[siteLabel,()=>{setSlot(null);setCategory(null);}]]:[]),...(slot?[[slot.label,()=>setCategory(null)]]:[]),...(category?[[category.label,null]]:[])];
 const back=crumbs.length>1?crumbs.at(-2)[1]:null,backTo=crumbs.length>1?'Back to '+crumbs.at(-2)[0]:'';
 const picked=(r,key)=>key&&(r.total?key===EVERY:r.key===key)?' report-row-picked':'';
 const withTotal=(lines)=>lines.rows.length?[...lines.rows,lines.total]:[];
 const columns=first=>[{key:'name',label:first==='site'?'Site':'Equipment category',value:r=>first==='site'?r.site:r.category},
  {key:'count',label,value:r=>r.count},{key:'assets',label:'Vehicles / equipment',value:r=>r.assets},{key:'dates',label:'Dates',value:r=>r.dates}];

 // Step 2: the dates down the side and the shifts across, the count of the report in each box.
 const grid=dateShiftGrid(slots.rows,{sumKeys:['count'],lineOf:r=>manySites?{...dateLine(r),key:r.date+'|'+r.site,label:dateLine(r).label+' · '+r.site}:dateLine(r)});
 const dayColumns=[{key:'count',label:'Day '+noun,value:t=>t.count}];
 const gridExport=dateShiftExport(grid,{count:r=>r.count,countLabel:noun,dayColumns});
 const slotWhere=siteLabel+' · '+(slot?slot.label:'');

 return <div className="saved-report-steps">
  <nav className="tt-crumbs" aria-label="Steps">{back&&<StepBackButton onBack={back} label={backTo}/>}{crumbs.map(([text,go],i)=><React.Fragment key={i}>{i>0&&<span aria-hidden="true">›</span>}{go&&i<crumbs.length-1?<button type="button" onClick={go}>{text}</button>:<strong aria-current="step">{text}</strong>}</React.Fragment>)}</nav>
  <ReportSection key={'srs-sites-'+id} reportKey={title+' sites'} dataReady={dataReady} recordDateFilter={recordDateFilter} title={'Step 1 · '+title+' · All sites · '+period} category={'operations-'+id+'-sites'}
   description={'One line per site with the '+noun+' of this report. Press a site to see it date by date and shift by shift; press All sites for every site together.'}
   rows={withTotal(sites)} columns={columns('site')} rowKey={r=>r.id} rowClassName={r=>(r.total?'tt-total':'')+picked(r,site)} isTotalRow={isTotal} onRowClick={openSite} emptyMessage="Nothing in these dates and filters."/>
  {level>=2&&<ReportSection key={'srs-shifts-'+id+site} reportKey={title+' date by shift'} dataReady={dataReady} title={'Step 2 · '+title+' · '+siteLabel+' · date by shift · '+period} category={'operations-'+id+'-shifts'}
   description={'The '+noun+' of each date and shift. Press a box for that shift by equipment category, or the All dates line for every date and shift together.'}
   rows={gridExport.rows} columns={gridExport.columns} rowKey={r=>r.id} showSearch={false} recordDateFilter={false}>
   <DateShiftGrid grid={grid} count={r=>r.count} countLabel={label} dayColumns={dayColumns} onOpen={r=>openSlot(r)} onOpenAll={()=>openSlot(null)}
    isPicked={r=>slot?.key===r.date+'|'+r.shift&&(!manySites||slot.siteKey===r.key.split('|')[2])} allPicked={slot?.key===EVERY} ariaLabel={title+' by date and shift'} emptyMessage="Nothing at this site in these dates."/>
  </ReportSection>}
  {level>=3&&<ReportSection key={'srs-categories-'+id+site+slot.key} reportKey={title+' by equipment category'} dataReady={dataReady} title={'Step 3 · '+title+' · '+slotWhere+' · by equipment category'} category={'operations-'+id+'-categories'}
   description={'One line per equipment category (the vehicle’s or machine’s group in the Equipment master), the most '+noun+' on top. Press a category for its lines of the report; press All categories for every one.'}
   rows={withTotal(categories)} columns={columns('category')} rowKey={r=>r.id} rowClassName={r=>(r.total?'tt-total':'')+picked(r,category?.key)} isTotalRow={isTotal} onRowClick={openCategory} emptyMessage="Nothing in this date and shift."/>}
  {level>=4&&table&&<ReportSection key={'srs-table-'+id+site+slot.key+category.key} reportKey={title} dataReady={dataReady} title={'Step 4 · '+title+' · '+slotWhere+' · '+category.label}
   category={'operations-'+id} description={table.note||'The lines of the report for what is open above.'}
   columns={table.columns.map((text,index)=>({key:id+'-'+index,label:text,value:row=>row[index]}))} rows={table.rows} emptyMessage="No matching records or exceptions found."/>}
 </div>;
}
