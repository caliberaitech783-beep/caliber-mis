import React,{useState} from 'react';

// The VLB batch look for any list of records: a Smart Search box beside the title and the shared report table under it,
// with a filter and sort menu on every heading, Rows, Actions and Smart Print. Every other prop goes to ReportSection.
export default function SmartSearchReport({ReportSection,searchLabel,placeholder,...props}){
 const [search,setSearch]=useState('');
 return <ReportSection recordDateFilter={false} smartPrintAction {...props} showSearch={false} query={search} onResetSearch={()=>setSearch('')}
  headingControl={<div className="generated-report-search"><label>Smart Search<input type="search" data-smart-search aria-label={searchLabel} placeholder={placeholder} value={search} onChange={event=>setSearch(event.target.value)}/></label></div>}/>;
}
