// The register of site moves, for HR (owner, 22 Nov 2026). A worker's site changes only by Fetch from Pulse-II
// with OTP on a card (server/routes/employee-site-move.mjs); every such move is one line here: who moved, from
// which site to which, from which date, who asked, whose OTP approved it and which card it was.
import React,{useEffect,useState} from 'react';
import {buildXlsxSheetsWorkbook} from '../shared/report-xlsx.mjs';
import {downloadBlob} from './download-history.mjs';
import {SITE_MOVE_HEADINGS,siteMoveCells,siteMoveSheets} from './employee-site-move-sheet.mjs';

export default function EmployeeSiteMoves({session}){
 const [moves,setMoves]=useState(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;(async()=>{
  try{
   const response=await fetch('/api/employee-master/site-moves',{headers:{Authorization:`Bearer ${session.token}`}});
   const body=await response.json();
   if(!response.ok)throw new Error(body.error||'The register of site moves is unavailable.');
   if(live)setMoves(body.moves||[]);
  }catch(e){if(live)setError(e.message);}
 })();return()=>{live=false};},[session.token]);
 const download=()=>downloadBlob(buildXlsxSheetsWorkbook('Site moves approved by OTP',siteMoveSheets(moves)),`Employee-site-moves-${new Date().toISOString().slice(0,10)}.xlsx`,{title:'Site moves approved by OTP'});
 return <details className="employee-site-moves">
  <summary>Site moves approved by OTP{moves?` (${moves.length.toLocaleString('en-IN')})`:''}</summary>
  <p>A worker's site changes only by Fetch from Pulse-II with OTP on a card, or from HR's master Excel. Each OTP move is one line here. The site does not change back by itself.</p>
  {error&&<p className="employee-error" role="alert">{error}</p>}
  {moves&&!moves.length&&<p>No worker has been moved yet.</p>}
  {moves&&moves.length>0&&<><button type="button" onClick={download}>Download the register (Excel)</button>
   <div className="employee-site-moves-table"><table><thead><tr>{SITE_MOVE_HEADINGS.map(label=><th key={label}>{label}</th>)}</tr></thead>
    <tbody>{moves.map(move=><tr key={move.id}>{siteMoveCells(move).map((cell,i)=><td key={i}>{cell}</td>)}</tr>)}</tbody></table></div></>}
 </details>;
}
