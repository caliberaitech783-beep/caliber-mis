import React from 'react';

// Step 2 of the owner's report pattern (15 Nov 2026, the OT Multiple Duties "date by shift" table): one line per date, the
// shifts side by side, and in each shift box the count followed by a coloured box for every colour found there. Pressing
// the count or a colour opens that shift in the step below, which stays on screen under this one.
// A report only builds the lines (dateShiftGrid) and says which colours to show; the drawing is the same everywhere.
const dmy=d=>/^\d{4}-\d{2}-\d{2}/.test(String(d))?d.slice(8,10)+'-'+d.slice(5,7)+'-'+d.slice(2,4):String(d||'');
const WEEKDAYS=['SUN','MON','TUE','WED','THU','FRI','SAT'];
const weekday=d=>/^\d{4}-\d{2}-\d{2}$/.test(String(d))?WEEKDAYS[new Date(d+'T00:00:00Z').getUTCDay()]:'';
const sum=(list,keys)=>Object.fromEntries(keys.map(k=>[k,list.reduce((n,r)=>n+(Number(r[k])||0),0)]));
const byText=(a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true});
export const dateLine=r=>({key:String(r.date||''),label:dmy(r.date),sub:weekday(r.date)});

// `rows`: one row per date and shift (a report's own shift lines). `sumKeys`: the counts added up for a whole day, a whole
// shift and every date. `lineOf` groups rows into lines (the date by default; All sites adds the site).
export function dateShiftGrid(rows,{sumKeys=[],lineOf=dateLine,shiftOf=r=>r.shift}={}){
 const shifts=[...new Set(rows.map(shiftOf))].sort(byText);
 const lines=new Map();
 for(const r of rows){
  const line=lineOf(r);
  if(!lines.has(line.key))lines.set(line.key,{...line,cells:{},list:[]});
  const held=lines.get(line.key);(held.cells[shiftOf(r)]||=[]).push(r);held.list.push(r);
 }
 return {
  shifts,
  lines:[...lines.values()].sort((a,b)=>byText(a.sort??a.key,b.sort??b.key)).map(l=>({...l,day:sum(l.list,sumKeys)})),
  shiftTotals:Object.fromEntries(shifts.map(s=>[s,sum(rows.filter(r=>shiftOf(r)===s),sumKeys)])),
  all:sum(rows,sumKeys)
 };
}

// The same lines flat, for Smart Print, PDF and Excel: one column per shift count and colour, then the day columns.
export function dateShiftExport(grid,{count,countLabel,boxes=[],dayColumns=[],shiftLabel=s=>s,label='Date',cellText}){
 const cellOf=(l,s)=>l.cells[s]||[];
 const columns=[{key:'line',label,value:r=>r.label},
  ...grid.shifts.flatMap(s=>cellText
   ?[{key:'s-'+s,label:shiftLabel(s),value:r=>cellText(cellOf(r,s))||'—'}]
   :[{key:'s-'+s,label:shiftLabel(s)+' '+countLabel,value:r=>cellOf(r,s)[0]?count(cellOf(r,s)[0]):0},
    ...boxes.map(b=>({key:'s-'+s+'-'+b.key,label:shiftLabel(s)+' '+b.label,value:r=>cellOf(r,s)[0]?.[b.key]||0}))]),
  ...dayColumns.map(c=>({key:'d-'+c.key,label:c.label,value:r=>c.value(r.day,r)}))];
 // The All dates line closes the printed table as it closes the one on screen.
 const all=grid.lines.length>1?[{id:'all-dates',key:'all-dates',label:'All dates',cells:Object.fromEntries(grid.shifts.map(s=>[s,[grid.shiftTotals[s]]])),day:grid.all}]:[];
 return {columns,rows:[...grid.lines.map(l=>({...l,id:l.key})),...all]};
}

export function DateShiftGrid({grid,count,countLabel='',boxes=[],renderCell,dayColumns=[],onOpen,onOpenAll,isPicked=()=>false,pickedBox='',allPicked=false,cellNote=null,shiftLabel=s=>s,label='Date',ariaLabel='By date and shift',emptyMessage='Nothing in these dates.',hint=null}){
 if(!grid.lines.length)return <div className="reports-detail-table dsg">{hint}<p className="dsg-empty">{emptyMessage}</p></div>;
 // A box with a `range` (owner, 16 Nov 2026: "above 36 it should write from which to which") puts that range above its
 // colour in the shift heading; every colour then keeps its own place in the box, an empty place where it is 0, so the
 // figures stay under their range.
 const ranged=boxes.some(b=>b.range);
 const gap=b=>ranged?<span key={b.key} className="dsg-box dsg-box-gap" aria-hidden="true"/>:null;
 // The range is written inside each box too, under its figure (owner, 16 Nov 2026), so a box read alone still says its minutes.
 const inside=b=>b.range?<small aria-hidden="true">{b.range}</small>:null;
 const cell=(list,where)=>{
  if(!list?.length)return <span className="dsg-zero">0</span>;
  if(renderCell)return renderCell(list,where);
  const r=list[0],on=isPicked(r),n=count(r);
  return <span className="dsg-cell">
   <button type="button" className="dsg-count" aria-pressed={on&&!pickedBox} aria-label={n+' '+countLabel+' · '+where} onClick={()=>onOpen(r,'')}>{n}</button>
   {boxes.map(b=>r[b.key]>0?<button key={b.key} type="button" className={'dsg-box '+b.className} aria-pressed={on&&pickedBox===b.key} title={b.label} aria-label={r[b.key]+' '+b.label+' · '+where} onClick={()=>onOpen(r,b.key)}>{r[b.key]}{inside(b)}</button>:gap(b))}
   {cellNote&&cellNote(r)?<small className="dsg-note">{cellNote(r)}</small>:null}
  </span>;
 };
 const totalCell=t=>t?<span className="dsg-cell"><span className="dsg-count">{count(t)}</span>{boxes.map(b=>t[b.key]>0?<span key={b.key} className={'dsg-box '+b.className} title={b.label}>{t[b.key]}{inside(b)}</span>:gap(b))}</span>:null;
 const dayCell=(c,sums,line)=>c.render?c.render(sums,line):c.value(sums,line);
 return <div className="reports-detail-table dsg" role="group" aria-label={ariaLabel}>
  {hint}
  <table className={'report-filter-table dsg-table'+(ranged?' dsg-ranged':'')}>
   <thead><tr><th scope="col">{label}</th>{grid.shifts.map(s=><th key={s} scope="col">{shiftLabel(s)}{ranged
    ?<span className="dsg-cell dsg-legend"><small>{countLabel}</small>{boxes.map(b=><span key={b.key} className={'dsg-box dsg-range '+b.className} title={b.label}>{b.range}</span>)}</span>
    :countLabel&&<small>{countLabel}{boxes.length?' · colours':''}</small>}</th>)}{dayColumns.map(c=><th key={c.key} scope="col">{c.label}{c.sub&&<small>{c.sub}</small>}</th>)}</tr></thead>
   <tbody>{grid.lines.map(l=><tr key={l.key} className={l.list.some(isPicked)?'report-row-picked':undefined}>
    <th scope="row">{l.label}{l.sub&&<small>{l.sub}</small>}</th>
    {grid.shifts.map(s=><td key={s}>{cell(l.cells[s],l.label+' · '+shiftLabel(s))}</td>)}
    {dayColumns.map(c=><td key={c.key}>{dayCell(c,l.day,l)}</td>)}
   </tr>)}</tbody>
   {grid.lines.length>1&&<tfoot><tr className={'dsg-total'+(allPicked?' report-row-picked':'')}>
    <th scope="row">{onOpenAll?<button type="button" className="dsg-all" aria-pressed={allPicked} onClick={onOpenAll}>All dates</button>:'All dates'}</th>
    {grid.shifts.map(s=><td key={s}>{renderCell?null:totalCell(grid.shiftTotals[s])}</td>)}
    {dayColumns.map(c=><td key={c.key}>{dayCell(c,grid.all,null)}</td>)}
   </tr></tfoot>}
  </table>
 </div>;
}
